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
  PURCHASE_INTENT_BANDS,
  PURCHASE_INTENT_CALCULATED,
  PURCHASE_INTENT_CHANGED,
  PURCHASE_INTENT_DEFAULT_TICKET,
  PURCHASE_INTENT_HIGH,
  PURCHASE_INTENT_HIGH_MAX,
  PURCHASE_INTENT_LOW_MAX,
  PURCHASE_INTENT_MEDIUM_MAX,
  PURCHASE_INTENT_PIPELINE,
  PURCHASE_INTENT_VERY_HIGH,
  PURCHASE_INTENT_VERY_LOW_MAX,
  PURCHASE_INTENT_WEIGHTS,
  SALES_MEMORY_KEY,
} from './ai.constants';
import { SalesMemoryService } from './sales-memory.service';
import type { PurchaseIntentBand, SalesMemory } from './sales-memory.types';

export type PurchaseIntentSignals = {
  leadStatus?: LeadStatus | null;
  intentHistory?: AiIntent[];
  askedWarranty?: boolean;
  inboundCount?: number;
  lastInboundAt?: Date | null;
  lastOutboundAt?: Date | null;
  recoveryIgnored?: boolean;
  fastReply?: boolean;
  complaintSeen?: boolean;
};

export type PurchaseIntentBreakdown = Record<string, number>;

export type PurchaseIntentResult = {
  purchaseIntent: PurchaseIntentBand;
  purchaseIntentScore: number;
  breakdown: PurchaseIntentBreakdown;
};

type Actor = { cid: string; sub: string };

@Injectable()
export class PurchaseIntentService {
  private readonly logger = new Logger(PurchaseIntentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly salesMemory: SalesMemoryService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  getBand(score: number): PurchaseIntentBand {
    const s = this.clamp(score);
    if (s <= PURCHASE_INTENT_VERY_LOW_MAX) return 'VERY_LOW';
    if (s <= PURCHASE_INTENT_LOW_MAX) return 'LOW';
    if (s <= PURCHASE_INTENT_MEDIUM_MAX) return 'MEDIUM';
    if (s <= PURCHASE_INTENT_HIGH_MAX) return 'HIGH';
    return 'VERY_HIGH';
  }

  /**
   * Pure calculation from Sales Memory + activity signals (no I/O).
   */
  calculate(
    memory: SalesMemory,
    signals: PurchaseIntentSignals = {},
  ): PurchaseIntentResult {
    const w = PURCHASE_INTENT_WEIGHTS;
    const breakdown: PurchaseIntentBreakdown = {};
    let score = 0;

    if (signals.leadStatus === LeadStatus.LOST) {
      breakdown.leadLost = w.leadLost;
      const clamped = this.clamp(w.leadLost + 10);
      return {
        purchaseIntent: this.getBand(clamped),
        purchaseIntentScore: clamped,
        breakdown,
      };
    }

    if (memory.temperature === 'HOT') {
      breakdown.temperatureHot = w.temperatureHot;
      score += w.temperatureHot;
    } else if (memory.temperature === 'WARM') {
      breakdown.temperatureWarm = w.temperatureWarm;
      score += w.temperatureWarm;
    } else {
      breakdown.temperatureCold = w.temperatureCold;
      score += w.temperatureCold;
    }

    const fromLeadScore = Math.round(memory.score * w.leadScoreFactor);
    if (fromLeadScore !== 0) {
      breakdown.leadScore = fromLeadScore;
      score += fromLeadScore;
    }

    const intents = signals.intentHistory ?? [];
    if (intents.includes(AiIntent.PRICE)) {
      breakdown.askedPrice = w.askedPrice;
      score += w.askedPrice;
    }
    if (
      intents.includes(AiIntent.PAYMENT) ||
      Boolean(memory.paymentPreference)
    ) {
      breakdown.askedPayment = w.askedPayment;
      score += w.askedPayment;
    }
    if (
      intents.includes(AiIntent.DELIVERY) ||
      Boolean(memory.deliveryPreference)
    ) {
      breakdown.askedDelivery = w.askedDelivery;
      score += w.askedDelivery;
    }
    if (signals.askedWarranty) {
      breakdown.askedWarranty = w.askedWarranty;
      score += w.askedWarranty;
    }

    if (memory.productInterest.length > 0) {
      breakdown.hasProduct = w.hasProduct;
      score += w.hasProduct;
    }
    if (memory.budget) {
      breakdown.hasBudget = w.hasBudget;
      score += w.hasBudget;
    }
    if (memory.city) {
      breakdown.hasCity = w.hasCity;
      score += w.hasCity;
    }
    if (memory.paymentPreference) {
      breakdown.hasPaymentPref = w.hasPaymentPref;
      score += w.hasPaymentPref;
    }
    if (memory.deliveryPreference) {
      breakdown.hasDeliveryPref = w.hasDeliveryPref;
      score += w.hasDeliveryPref;
    }

    if (memory.purchaseIntentLevel === 'HIGH') {
      breakdown.slotPurchaseHigh = w.slotPurchaseHigh;
      score += w.slotPurchaseHigh;
    } else if (memory.purchaseIntentLevel === 'MEDIUM') {
      breakdown.slotPurchaseMedium = w.slotPurchaseMedium;
      score += w.slotPurchaseMedium;
    }

    if (memory.nextBestAction === 'OFFER_CLOSE') {
      breakdown.nbaOfferClose = w.nbaOfferClose;
      score += w.nbaOfferClose;
    } else if (memory.nextBestAction === 'OFFER_ALTERNATIVE') {
      breakdown.nbaOfferAlternative = w.nbaOfferAlternative;
      score += w.nbaOfferAlternative;
    }

    if (signals.fastReply) {
      breakdown.fastReply = w.fastReply;
      score += w.fastReply;
    }

    const recentObjections = memory.objectionHistory.length;
    if (recentObjections === 0 && !memory.lastObjection) {
      breakdown.noRecentObjection = w.noRecentObjection;
      score += w.noRecentObjection;
    }

    const inbound = signals.inboundCount ?? 0;
    if (inbound > 1) {
      const multi = Math.min(
        (inbound - 1) * w.multiInboundPerExtra,
        w.multiInboundCap,
      );
      breakdown.multiInbound = multi;
      score += multi;
    }

    if (
      memory.temperature === 'HOT' &&
      memory.productInterest.length > 0 &&
      memory.budget &&
      memory.paymentPreference
    ) {
      breakdown.closeReadyBonus = w.closeReadyBonus;
      score += w.closeReadyBonus;
    }

    // Negatives
    if (signals.complaintSeen || intents.includes(AiIntent.COMPLAINT)) {
      breakdown.complaintHistory = w.complaintHistory;
      score += w.complaintHistory;
    }

    if (
      memory.lastObjection === 'AUTHORITY' ||
      memory.objectionHistory.some((h) => h.type === 'AUTHORITY')
    ) {
      breakdown.authorityObjection = w.authorityObjection;
      score += w.authorityObjection;
    }

    if (memory.lastObjection === 'NEED') {
      breakdown.needObjection = w.needObjection;
      score += w.needObjection;
    }

    const maxSame = this.maxSameObjection(memory);
    if (maxSame >= 2) {
      breakdown.repeatedObjections = w.repeatedObjections;
      score += w.repeatedObjections;
    }

    if (signals.recoveryIgnored) {
      breakdown.recoveryIgnored = w.recoveryIgnored;
      score += w.recoveryIgnored;
    }

    if (this.isSilent(signals.lastInboundAt, signals.lastOutboundAt, 3)) {
      breakdown.silence = w.silence;
      score += w.silence;
    }

    if (this.isSilent(signals.lastInboundAt, signals.lastOutboundAt, 7)) {
      breakdown.prolongedCooldown = w.prolongedCooldown;
      score += w.prolongedCooldown;
    }

    const clamped = this.clamp(score);
    return {
      purchaseIntent: this.getBand(clamped),
      purchaseIntentScore: clamped,
      breakdown,
    };
  }

  async calculateAndPersist(input: {
    companyId: string;
    conversationId: string;
    leadId?: string;
    intent?: AiIntent | null;
    actorUserId?: string | null;
  }): Promise<
    PurchaseIntentResult & {
      changed: boolean;
      previous: PurchaseIntentResult | null;
    }
  > {
    const conv = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        companyId: input.companyId,
        deletedAt: null,
      },
      select: {
        id: true,
        metadata: true,
        leadId: true,
        lead: {
          select: {
            id: true,
            status: true,
            lastInboundAt: true,
            lastOutboundAt: true,
          },
        },
      },
    });
    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    const leadId = input.leadId ?? conv.leadId;
    const memory = this.salesMemory.readFromMetadata(conv.metadata);
    const signals = await this.collectSignals({
      companyId: input.companyId,
      conversationId: conv.id,
      leadId,
      lead: conv.lead,
      currentIntent: input.intent,
    });

    const previous: PurchaseIntentResult | null =
      memory.purchaseIntentUpdatedAt != null
        ? {
            purchaseIntent: memory.purchaseIntent ?? 'VERY_LOW',
            purchaseIntentScore: memory.purchaseIntentScore,
            breakdown: {},
          }
        : null;

    const result = this.calculate(memory, signals);
    const changed =
      !previous ||
      previous.purchaseIntent !== result.purchaseIntent ||
      previous.purchaseIntentScore !== result.purchaseIntentScore;

    if (!changed && memory.purchaseIntentUpdatedAt) {
      return { ...result, changed: false, previous };
    }

    const at = new Date().toISOString();
    const nextMemory: SalesMemory = {
      ...memory,
      purchaseIntent: result.purchaseIntent,
      purchaseIntentScore: result.purchaseIntentScore,
      purchaseIntentUpdatedAt: at,
      version: memory.version === 0 ? 1 : memory.version + (changed ? 1 : 0),
      updatedAt: at,
    };
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

    const prevBand = previous?.purchaseIntent ?? null;

    await this.prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: conv.id },
        data: { metadata: nextMeta },
      });

      await this.audit.write(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId ?? null,
        action: PURCHASE_INTENT_CALCULATED,
        targetType: 'CONVERSATION',
        targetId: conv.id,
        before: previous
          ? {
              purchaseIntent: previous.purchaseIntent,
              purchaseIntentScore: previous.purchaseIntentScore,
            }
          : null,
        after: {
          purchaseIntent: result.purchaseIntent,
          purchaseIntentScore: result.purchaseIntentScore,
          breakdown: result.breakdown,
          leadId,
          pipeline: PURCHASE_INTENT_PIPELINE,
        },
      });

      if (changed && prevBand && prevBand !== result.purchaseIntent) {
        await this.audit.write(tx, {
          companyId: input.companyId,
          actorUserId: input.actorUserId ?? null,
          action: PURCHASE_INTENT_CHANGED,
          targetType: 'CONVERSATION',
          targetId: conv.id,
          before: { purchaseIntent: prevBand },
          after: {
            purchaseIntent: result.purchaseIntent,
            purchaseIntentScore: result.purchaseIntentScore,
            leadId,
            pipeline: PURCHASE_INTENT_PIPELINE,
          },
        });
      }

      if (result.purchaseIntent === 'VERY_HIGH' && prevBand !== 'VERY_HIGH') {
        await this.audit.write(tx, {
          companyId: input.companyId,
          actorUserId: input.actorUserId ?? null,
          action: PURCHASE_INTENT_VERY_HIGH,
          targetType: 'LEAD',
          targetId: leadId,
          before: { purchaseIntent: prevBand },
          after: {
            purchaseIntent: result.purchaseIntent,
            purchaseIntentScore: result.purchaseIntentScore,
            conversationId: conv.id,
          },
        });
      } else if (
        result.purchaseIntent === 'HIGH' &&
        prevBand !== 'HIGH' &&
        prevBand !== 'VERY_HIGH'
      ) {
        await this.audit.write(tx, {
          companyId: input.companyId,
          actorUserId: input.actorUserId ?? null,
          action: PURCHASE_INTENT_HIGH,
          targetType: 'LEAD',
          targetId: leadId,
          before: { purchaseIntent: prevBand },
          after: {
            purchaseIntent: result.purchaseIntent,
            purchaseIntentScore: result.purchaseIntentScore,
            conversationId: conv.id,
          },
        });
      }
    });

    this.prom?.recordPurchaseIntentCalculated(result.purchaseIntent);
    if (changed && prevBand && prevBand !== result.purchaseIntent) {
      this.prom?.recordPurchaseIntentChanged(result.purchaseIntent);
    }
    if (result.purchaseIntent === 'VERY_HIGH' && prevBand !== 'VERY_HIGH') {
      this.prom?.recordPurchaseIntentVeryHigh();
    } else if (
      result.purchaseIntent === 'HIGH' &&
      prevBand !== 'HIGH' &&
      prevBand !== 'VERY_HIGH'
    ) {
      this.prom?.recordPurchaseIntentHigh();
    }

    this.logger.debug(
      `purchase intent company=${input.companyId} conversation=${conv.id} score=${result.purchaseIntentScore} band=${result.purchaseIntent}`,
    );

    return { ...result, changed: true, previous };
  }

  async getForConversation(actor: Actor, conversationId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        companyId: actor.cid,
        deletedAt: null,
      },
      select: {
        id: true,
        leadId: true,
        metadata: true,
        lead: { select: { status: true } },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    const memory = this.salesMemory.readFromMetadata(conv.metadata);
    return {
      companyId: actor.cid,
      conversationId: conv.id,
      leadId: conv.leadId,
      leadStatus: conv.lead.status,
      purchaseIntent: memory.purchaseIntent,
      purchaseIntentScore: memory.purchaseIntentScore,
      purchaseIntentUpdatedAt: memory.purchaseIntentUpdatedAt,
      temperature: memory.temperature,
      score: memory.score,
      bands: this.bandLabels(),
      readOnly: true,
    };
  }

  async getForLead(actor: Actor, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId: actor.cid, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    const conv = await this.prisma.conversation.findFirst({
      where: { companyId: actor.cid, leadId, deletedAt: null },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true },
    });
    if (!conv) {
      return {
        companyId: actor.cid,
        leadId,
        leadStatus: lead.status,
        conversationId: null,
        purchaseIntent: null,
        purchaseIntentScore: 0,
        purchaseIntentUpdatedAt: null,
        bands: this.bandLabels(),
        readOnly: true,
      };
    }
    const detail = await this.getForConversation(actor, conv.id);
    return {
      companyId: actor.cid,
      leadId,
      leadStatus: lead.status,
      conversationId: conv.id,
      purchaseIntent: detail.purchaseIntent,
      purchaseIntentScore: detail.purchaseIntentScore,
      purchaseIntentUpdatedAt: detail.purchaseIntentUpdatedAt,
      temperature: detail.temperature,
      score: detail.score,
      bands: this.bandLabels(),
      readOnly: true,
    };
  }

  async getDashboard(actor: Actor) {
    const companyId = actor.cid;
    const conversations = await this.prisma.conversation.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        metadata: true,
        lead: { select: { status: true } },
      },
      take: 2000,
    });

    const counts = Object.fromEntries(
      PURCHASE_INTENT_BANDS.map((b) => [b, 0]),
    ) as Record<PurchaseIntentBand, number>;
    const conversions = Object.fromEntries(
      PURCHASE_INTENT_BANDS.map((b) => [b, 0]),
    ) as Record<PurchaseIntentBand, number>;
    const revenue = Object.fromEntries(
      PURCHASE_INTENT_BANDS.map((b) => [b, 0]),
    ) as Record<PurchaseIntentBand, number>;

    let scored = 0;
    for (const c of conversations) {
      const mem = this.salesMemory.readFromMetadata(c.metadata);
      if (mem.purchaseIntentUpdatedAt == null && mem.purchaseIntent == null) {
        continue;
      }
      const band = mem.purchaseIntent ?? this.getBand(mem.purchaseIntentScore);
      scored += 1;
      counts[band] += 1;
      const ticket = this.parseBudgetValue(mem.budget);
      revenue[band] += ticket;
      if (c.lead.status === LeadStatus.CONVERTED) {
        conversions[band] += 1;
      }
    }

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      bands: counts,
      conversionsByBand: conversions,
      estimatedRevenueByBand: revenue,
      scoredConversations: scored,
      bandRanges: this.bandLabels(),
      weights: PURCHASE_INTENT_WEIGHTS,
      pipeline: PURCHASE_INTENT_PIPELINE,
      currency: 'BRL',
    };
  }

  /** Context line for ASSIST/AUTO metadata only — never triggers actions. */
  formatContextLine(memory: SalesMemory): string | null {
    if (memory.purchaseIntentUpdatedAt == null || !memory.purchaseIntent) {
      return null;
    }
    return `Purchase Intent: ${memory.purchaseIntent} (${memory.purchaseIntentScore}/100)`;
  }

  private async collectSignals(input: {
    companyId: string;
    conversationId: string;
    leadId: string;
    lead: {
      status: LeadStatus;
      lastInboundAt: Date | null;
      lastOutboundAt: Date | null;
    };
    currentIntent?: AiIntent | null;
  }): Promise<PurchaseIntentSignals> {
    const [messages, recoveryIgnored] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          companyId: input.companyId,
          conversationId: input.conversationId,
          deletedAt: null,
          direction: 'INBOUND',
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: {
          body: true,
          createdAt: true,
          metadata: true,
        },
      }),
      this.detectRecoveryIgnored(
        input.companyId,
        input.leadId,
        input.lead.lastInboundAt,
      ),
    ]);

    const intentHistory: AiIntent[] = [];
    if (input.currentIntent) intentHistory.push(input.currentIntent);
    let askedWarranty = false;
    let complaintSeen = false;
    for (const m of messages) {
      const meta =
        m.metadata &&
        typeof m.metadata === 'object' &&
        !Array.isArray(m.metadata)
          ? (m.metadata as Record<string, unknown>)
          : null;
      const intent = meta?.intent;
      if (
        typeof intent === 'string' &&
        Object.values(AiIntent).includes(intent as AiIntent)
      ) {
        intentHistory.push(intent as AiIntent);
      }
      if (intent === AiIntent.COMPLAINT) complaintSeen = true;
      if (/\b(garantia|warranty|confi[aá]vel)\b/i.test(m.body ?? '')) {
        askedWarranty = true;
      }
    }

    const lastInbound = input.lead.lastInboundAt;
    const lastOutbound = input.lead.lastOutboundAt;
    const fastReply =
      Boolean(lastInbound && lastOutbound) &&
      lastInbound!.getTime() > lastOutbound!.getTime() &&
      lastInbound!.getTime() - lastOutbound!.getTime() <= 2 * 3600_000;

    return {
      leadStatus: input.lead.status,
      intentHistory: [...new Set(intentHistory)],
      askedWarranty,
      inboundCount: messages.length,
      lastInboundAt: lastInbound,
      lastOutboundAt: lastOutbound,
      recoveryIgnored,
      fastReply,
      complaintSeen,
    };
  }

  private async detectRecoveryIgnored(
    companyId: string,
    leadId: string,
    lastInboundAt: Date | null,
  ): Promise<boolean> {
    const recovery = await this.prisma.followUp.findFirst({
      where: {
        companyId,
        leadId,
        deletedAt: null,
        type: AI_RECOVERY_FOLLOWUP_TYPE,
        status: FollowUpStatus.EXECUTED,
        executedAt: { not: null },
      },
      orderBy: { executedAt: 'desc' },
      select: { executedAt: true },
    });
    if (!recovery?.executedAt) return false;
    if (!lastInboundAt) {
      const hours = (Date.now() - recovery.executedAt.getTime()) / 3600_000;
      return hours >= 48;
    }
    return lastInboundAt.getTime() < recovery.executedAt.getTime();
  }

  private maxSameObjection(memory: SalesMemory): number {
    const counts = new Map<string, number>();
    for (const h of memory.objectionHistory) {
      counts.set(h.type, (counts.get(h.type) ?? 0) + 1);
    }
    if (memory.lastObjection) {
      counts.set(
        memory.lastObjection,
        Math.max(counts.get(memory.lastObjection) ?? 0, 1),
      );
    }
    let max = 0;
    for (const n of counts.values()) max = Math.max(max, n);
    return max;
  }

  private isSilent(
    lastInboundAt?: Date | null,
    lastOutboundAt?: Date | null,
    days = 3,
  ): boolean {
    if (!lastOutboundAt) return false;
    const inbound = lastInboundAt?.getTime() ?? 0;
    const outbound = lastOutboundAt.getTime();
    if (inbound > outbound) return false;
    return (Date.now() - outbound) / (24 * 3600_000) >= days;
  }

  private parseBudgetValue(budget: string | null): number {
    if (!budget) return PURCHASE_INTENT_DEFAULT_TICKET;
    const cleaned = budget.replace(/[^\d,.]/g, '');
    const grouped = cleaned.match(/^(\d{1,3}(?:\.\d{3})+)(?:,\d{2})?$/);
    if (grouped) {
      const n = Number(grouped[1].replace(/\./g, ''));
      return Number.isFinite(n) && n > 0 ? n : PURCHASE_INTENT_DEFAULT_TICKET;
    }
    const plain = cleaned.match(/^(\d+)(?:,\d{2})?/);
    if (!plain) return PURCHASE_INTENT_DEFAULT_TICKET;
    const n = Number(plain[1]);
    return Number.isFinite(n) && n > 0 ? n : PURCHASE_INTENT_DEFAULT_TICKET;
  }

  private bandLabels() {
    return {
      VERY_LOW: `0–${PURCHASE_INTENT_VERY_LOW_MAX}`,
      LOW: `${PURCHASE_INTENT_VERY_LOW_MAX + 1}–${PURCHASE_INTENT_LOW_MAX}`,
      MEDIUM: `${PURCHASE_INTENT_LOW_MAX + 1}–${PURCHASE_INTENT_MEDIUM_MAX}`,
      HIGH: `${PURCHASE_INTENT_MEDIUM_MAX + 1}–${PURCHASE_INTENT_HIGH_MAX}`,
      VERY_HIGH: `${PURCHASE_INTENT_HIGH_MAX + 1}–100`,
    };
  }

  private clamp(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
}
