import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AiIntent, FollowUpStatus, LeadStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { AuditService } from '../audit/audit.service';
import {
  AI_RECOVERY_FOLLOWUP_TYPE,
  LEAD_BECAME_COLD,
  LEAD_BECAME_HOT,
  LEAD_BECAME_WARM,
  LEAD_SCORE_COLD_MAX,
  LEAD_SCORE_UPDATED,
  LEAD_SCORE_WARM_MAX,
  LEAD_SCORE_WEIGHTS,
  SALES_MEMORY_KEY,
} from './ai.constants';
import { SalesMemoryService } from './sales-memory.service';
import type { SalesMemory, SalesTemperature } from './sales-memory.types';

export type LeadScoreBreakdown = Record<string, number>;

export type LeadScoreResult = {
  score: number;
  temperature: SalesTemperature;
  breakdown: LeadScoreBreakdown;
};

export type LeadScoreSignals = {
  intent?: AiIntent | null;
  /** True when inbound arrived after a recent AI_RECOVERY send. */
  repliedRecovery?: boolean;
  inboundCount?: number;
  leadStatus?: LeadStatus | null;
  lastInboundAt?: Date | null;
  lastOutboundAt?: Date | null;
};

type Actor = { cid: string; sub: string };

@Injectable()
export class LeadScoringService {
  private readonly logger = new Logger(LeadScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly salesMemory: SalesMemoryService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  getTemperature(score: number): SalesTemperature {
    const s = this.clamp(score);
    if (s <= LEAD_SCORE_COLD_MAX) return 'COLD';
    if (s <= LEAD_SCORE_WARM_MAX) return 'WARM';
    return 'HOT';
  }

  /**
   * Pure calculation from Sales Memory + signals (no I/O).
   */
  calculate(
    memory: SalesMemory,
    signals: LeadScoreSignals = {},
  ): LeadScoreResult {
    const w = LEAD_SCORE_WEIGHTS;
    const breakdown: LeadScoreBreakdown = {};
    let score = 0;

    const askedProduct =
      memory.productInterest.length > 0 || signals.intent === AiIntent.PRODUCT;
    if (askedProduct) {
      breakdown.askedProduct = w.askedProduct;
      score += w.askedProduct;
    }

    if (signals.intent === AiIntent.PRICE) {
      breakdown.askedPrice = w.askedPrice;
      score += w.askedPrice;
    }

    if (memory.budget) {
      breakdown.hasBudget = w.hasBudget;
      score += w.hasBudget;
    }

    const askedPayment =
      Boolean(memory.paymentPreference) || signals.intent === AiIntent.PAYMENT;
    if (askedPayment) {
      breakdown.askedPayment = w.askedPayment;
      score += w.askedPayment;
    }

    const askedDelivery =
      Boolean(memory.deliveryPreference) ||
      signals.intent === AiIntent.DELIVERY;
    if (askedDelivery) {
      breakdown.askedDelivery = w.askedDelivery;
      score += w.askedDelivery;
    }

    if (memory.city) {
      breakdown.hasCity = w.hasCity;
      score += w.hasCity;
    }

    if (memory.urgency === 'HIGH') {
      breakdown.urgencyHigh = w.urgencyHigh;
      score += w.urgencyHigh;
    } else if (memory.urgency === 'MEDIUM') {
      breakdown.urgencyMedium = w.urgencyMedium;
      score += w.urgencyMedium;
    }

    if (memory.purchaseIntentLevel === 'HIGH') {
      breakdown.purchaseIntentHigh = w.purchaseIntentHigh;
      score += w.purchaseIntentHigh;
    } else if (memory.purchaseIntentLevel === 'MEDIUM') {
      breakdown.purchaseIntentMedium = w.purchaseIntentMedium;
      score += w.purchaseIntentMedium;
    } else if (memory.purchaseIntentLevel === 'LOW') {
      breakdown.purchaseIntentLow = w.purchaseIntentLow;
      score += w.purchaseIntentLow;
    }

    if (signals.repliedRecovery) {
      breakdown.repliedRecovery = w.repliedRecovery;
      score += w.repliedRecovery;
    }

    const inboundCount = signals.inboundCount ?? 0;
    if (inboundCount > 1) {
      const multi = Math.min(
        (inboundCount - 1) * w.multiInteractionPerExtra,
        w.multiInteractionCap,
      );
      breakdown.multiInteraction = multi;
      score += multi;
    }

    if (memory.lastObjection) {
      const strong =
        memory.lastObjection === 'CARO' ||
        memory.lastObjection === 'COMPARANDO_CONCORRENTE';
      const delta = strong ? w.strongObjection : w.softObjection;
      breakdown.objection = delta;
      score += delta;
    }

    if (signals.leadStatus === LeadStatus.LOST) {
      breakdown.leadLost = w.leadLost;
      score += w.leadLost;
    }

    const lastTouch = this.latestDate(
      signals.lastInboundAt,
      signals.lastOutboundAt,
    );
    if (lastTouch) {
      const days = (Date.now() - lastTouch.getTime()) / (24 * 3600_000);
      if (days > 2) {
        const inactive = Math.max(
          w.inactiveCap,
          -Math.floor(days - 2) * Math.abs(w.inactivePerDayAfter2d),
        );
        breakdown.inactive = inactive;
        score += inactive;
      }
    }

    // Unanswered outbound (we spoke last, client silent).
    if (
      signals.lastOutboundAt &&
      (!signals.lastInboundAt ||
        signals.lastOutboundAt.getTime() > signals.lastInboundAt.getTime())
    ) {
      const hours = (Date.now() - signals.lastOutboundAt.getTime()) / 3600_000;
      if (hours >= 48) {
        breakdown.unansweredOutbound = w.unansweredOutbound;
        score += w.unansweredOutbound;
      }
    }

    const clamped = this.clamp(score);
    return {
      score: clamped,
      temperature: this.getTemperature(clamped),
      breakdown,
    };
  }

  /**
   * Recalculate, persist into salesMemory, audit, mirror Lead.score.
   */
  async updateScore(input: {
    companyId: string;
    conversationId: string;
    leadId?: string;
    intent?: AiIntent | null;
    actorUserId?: string | null;
  }): Promise<
    LeadScoreResult & { changed: boolean; previous: LeadScoreResult | null }
  > {
    const conv = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        companyId: input.companyId,
        deletedAt: null,
      },
      select: {
        id: true,
        leadId: true,
        metadata: true,
        lead: {
          select: {
            id: true,
            status: true,
            score: true,
            lastInboundAt: true,
            lastOutboundAt: true,
          },
        },
      },
    });
    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    const memory = this.salesMemory.readFromMetadata(conv.metadata);
    const leadId = input.leadId ?? conv.leadId;

    const [inboundCount, repliedRecovery] = await Promise.all([
      this.prisma.message.count({
        where: {
          companyId: input.companyId,
          conversationId: input.conversationId,
          deletedAt: null,
          direction: 'INBOUND',
        },
      }),
      this.detectRecoveryReply(
        input.companyId,
        leadId,
        conv.lead.lastInboundAt,
      ),
    ]);

    const previous: LeadScoreResult = {
      score: memory.score,
      temperature: memory.temperature,
      breakdown: {},
    };

    const result = this.calculate(memory, {
      intent: input.intent,
      repliedRecovery,
      inboundCount,
      leadStatus: conv.lead.status,
      lastInboundAt: conv.lead.lastInboundAt,
      lastOutboundAt: conv.lead.lastOutboundAt,
    });

    const changed =
      result.score !== previous.score ||
      result.temperature !== previous.temperature;

    if (!changed && memory.lastScoreAt) {
      return { ...result, changed: false, previous };
    }

    const nextMemory: SalesMemory = {
      ...memory,
      score: result.score,
      temperature: result.temperature,
      lastScoreAt: new Date().toISOString(),
      version: memory.version === 0 ? 1 : memory.version + (changed ? 1 : 0),
      updatedAt: new Date().toISOString(),
    };
    // Keep version bump only when score actually changes (or first score).
    if (!changed && memory.version > 0) {
      nextMemory.version = memory.version;
    }

    const nextMeta = {
      ...(typeof conv.metadata === 'object' &&
      conv.metadata &&
      !Array.isArray(conv.metadata)
        ? (conv.metadata as Record<string, unknown>)
        : {}),
      [SALES_MEMORY_KEY]: nextMemory,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: conv.id },
        data: { metadata: nextMeta },
      });

      // Mirror CRM Lead.score for pipeline visibility (design §3.2).
      if (changed || conv.lead.score !== result.score) {
        await tx.lead.update({
          where: { id: leadId },
          data: { score: result.score },
        });
      }

      await this.audit.write(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId ?? null,
        action: LEAD_SCORE_UPDATED,
        targetType: 'CONVERSATION',
        targetId: conv.id,
        before: {
          score: previous.score,
          temperature: previous.temperature,
        },
        after: {
          score: result.score,
          temperature: result.temperature,
          breakdown: result.breakdown,
          leadId,
        },
      });

      if (previous.temperature !== result.temperature) {
        const action =
          result.temperature === 'HOT'
            ? LEAD_BECAME_HOT
            : result.temperature === 'WARM'
              ? LEAD_BECAME_WARM
              : LEAD_BECAME_COLD;
        await this.audit.write(tx, {
          companyId: input.companyId,
          actorUserId: input.actorUserId ?? null,
          action,
          targetType: 'LEAD',
          targetId: leadId,
          before: { temperature: previous.temperature, score: previous.score },
          after: { temperature: result.temperature, score: result.score },
        });
      }
    });

    if (previous.temperature !== result.temperature) {
      this.prom?.recordLeadScoreTemperature(result.temperature);
    }

    this.logger.debug(
      `lead score company=${input.companyId} conversation=${conv.id} score=${result.score} temp=${result.temperature}`,
    );

    return { ...result, changed: true, previous };
  }

  async getDashboard(actor: Actor) {
    const companyId = actor.cid;
    const conversations = await this.prisma.conversation.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        leadId: true,
        metadata: true,
        lead: { select: { status: true } },
      },
      take: 2000,
    });

    let hot = 0;
    let warm = 0;
    let cold = 0;
    let convertedHot = 0;
    let convertedWarm = 0;
    let convertedCold = 0;
    let scored = 0;

    for (const c of conversations) {
      const mem = this.salesMemory.readFromMetadata(c.metadata);
      if (mem.lastScoreAt == null && mem.score === 0 && mem.version === 0) {
        continue;
      }
      scored += 1;
      const temp = mem.temperature || this.getTemperature(mem.score);
      if (temp === 'HOT') hot += 1;
      else if (temp === 'WARM') warm += 1;
      else cold += 1;

      if (c.lead.status === LeadStatus.CONVERTED) {
        if (temp === 'HOT') convertedHot += 1;
        else if (temp === 'WARM') convertedWarm += 1;
        else convertedCold += 1;
      }
    }

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      temperatures: { HOT: hot, WARM: warm, COLD: cold },
      conversionsByTemperature: {
        HOT: convertedHot,
        WARM: convertedWarm,
        COLD: convertedCold,
      },
      scoredConversations: scored,
      bands: {
        COLD: `0–${LEAD_SCORE_COLD_MAX}`,
        WARM: `${LEAD_SCORE_COLD_MAX + 1}–${LEAD_SCORE_WARM_MAX}`,
        HOT: `${LEAD_SCORE_WARM_MAX + 1}–100`,
      },
      weights: LEAD_SCORE_WEIGHTS,
    };
  }

  private async detectRecoveryReply(
    companyId: string,
    leadId: string,
    lastInboundAt: Date | null,
  ): Promise<boolean> {
    if (!lastInboundAt) return false;
    const recovery = await this.prisma.followUp.findFirst({
      where: {
        companyId,
        leadId,
        deletedAt: null,
        type: AI_RECOVERY_FOLLOWUP_TYPE,
        status: FollowUpStatus.EXECUTED,
        executedAt: {
          not: null,
          lt: lastInboundAt,
          gte: new Date(lastInboundAt.getTime() - 7 * 24 * 3600_000),
        },
      },
      select: { id: true },
    });
    return Boolean(recovery);
  }

  private clamp(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  private latestDate(a?: Date | null, b?: Date | null): Date | null {
    if (a && b) return a.getTime() >= b.getTime() ? a : b;
    return a ?? b ?? null;
  }
}
