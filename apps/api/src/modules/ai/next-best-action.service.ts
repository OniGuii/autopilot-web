import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { FollowUpStatus, LeadStatus, type AiIntent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { AuditService } from '../audit/audit.service';
import {
  AI_RECOVERY_FOLLOWUP_TYPE,
  NBA_ACTIONS,
  NBA_CHANGED,
  NBA_DECIDED,
  NBA_EXECUTED,
  NBA_PIPELINE,
  NBA_SILENCE_DAYS,
  SALES_MEMORY_KEY,
} from './ai.constants';
import { SalesMemoryService } from './sales-memory.service';
import type {
  NextBestActionCode,
  SalesMemory,
  SalesTemperature,
} from './sales-memory.types';

export type NbaDecisionContext = {
  memory: SalesMemory;
  leadStatus: LeadStatus | null;
  agentPaused?: boolean;
  lastInboundAt?: Date | null;
  lastOutboundAt?: Date | null;
  hasPendingRecovery?: boolean;
  intent?: AiIntent | null;
};

export type NbaDecisionResult = {
  action: NextBestActionCode;
  reason: string;
  replyGoal: string;
  changed: boolean;
  previous: NextBestActionCode | null;
  temperature: SalesTemperature;
  score: number;
};

export type NbaEnrichment = {
  action: NextBestActionCode;
  replyGoal: string;
  reason: string;
  /** Short line to append / prefix onto suggested body (ASSIST/AUTO enrich only). */
  enrichLine: string;
};

type Actor = { cid: string; sub: string };

const ACTION_SET = new Set<string>(NBA_ACTIONS);

@Injectable()
export class NextBestActionService {
  private readonly logger = new Logger(NextBestActionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly salesMemory: SalesMemoryService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  /**
   * Pure decision from memory + lead/conversation signals (no I/O).
   * Priority: terminal → escalate → objection → close → slots → silence → wait.
   */
  decide(
    ctx: NbaDecisionContext,
  ): Omit<NbaDecisionResult, 'changed' | 'previous'> {
    const mem = ctx.memory;
    const temp = mem.temperature;
    const score = mem.score;

    if (ctx.leadStatus === LeadStatus.LOST) {
      return this.result(
        'WAIT',
        'LEAD_LOST',
        'Aguardar — lead perdido',
        temp,
        score,
      );
    }

    if (ctx.leadStatus === LeadStatus.CONVERTED) {
      return this.result(
        'WAIT',
        'LEAD_CONVERTED',
        'Aguardar — lead convertido',
        temp,
        score,
      );
    }

    if (ctx.agentPaused) {
      return this.result(
        'ESCALATE_HUMAN',
        'AGENT_PAUSED',
        'Humano no comando da conversa',
        temp,
        score,
      );
    }

    if (mem.lastObjection === 'AUTHORITY' || mem.lastObjection === 'NEED') {
      return this.result(
        'ESCALATE_HUMAN',
        `OBJECTION_${mem.lastObjection}`,
        'Escalar para humano (objeção sensível)',
        temp,
        score,
      );
    }

    if (mem.lastObjection === 'PRICE') {
      return this.result(
        'OFFER_ALTERNATIVE',
        'OBJECTION_PRICE',
        'Oferecer alternativa alinhada ao orçamento',
        temp,
        score,
      );
    }

    if (mem.lastObjection) {
      return this.result(
        'HANDLE_OBJECTION',
        `OBJECTION_${mem.lastObjection}`,
        'Tratar objeção ativa',
        temp,
        score,
      );
    }

    const hasProduct = mem.productInterest.length > 0;
    const hasPayment = Boolean(mem.paymentPreference);
    const hasDelivery = Boolean(mem.deliveryPreference);
    const hasBudget = Boolean(mem.budget);
    const hasCity = Boolean(mem.city);

    if (temp === 'HOT' && hasProduct && hasPayment && hasDelivery) {
      return this.result(
        'OFFER_CLOSE',
        'HOT_READY_TO_CLOSE',
        'Convidar ao fechamento',
        temp,
        score,
      );
    }

    if (!hasBudget) {
      return this.result(
        'ASK_BUDGET',
        'MISSING_BUDGET',
        'Descobrir orçamento',
        temp,
        score,
      );
    }

    if (!hasCity) {
      return this.result(
        'ASK_CITY',
        'MISSING_CITY',
        'Descobrir cidade / cobertura',
        temp,
        score,
      );
    }

    if (!hasProduct) {
      return this.result(
        'ASK_PRODUCT',
        'MISSING_PRODUCT',
        'Descobrir produto de interesse',
        temp,
        score,
      );
    }

    if (!hasPayment) {
      return this.result(
        'ASK_PAYMENT',
        'MISSING_PAYMENT',
        'Descobrir preferência de pagamento',
        temp,
        score,
      );
    }

    if (
      !ctx.hasPendingRecovery &&
      this.isSilentTooLong(ctx.lastInboundAt, ctx.lastOutboundAt)
    ) {
      return this.result(
        'SCHEDULE_RECOVERY',
        'SILENCE_THRESHOLD',
        'Agendar recovery por silêncio',
        temp,
        score,
      );
    }

    if (ctx.hasPendingRecovery) {
      return this.result(
        'WAIT',
        'RECOVERY_PENDING',
        'Aguardar recovery já agendado',
        temp,
        score,
      );
    }

    return this.result(
      'WAIT',
      'NO_ACTION',
      'Aguardar próximo sinal',
      temp,
      score,
    );
  }

  /**
   * Decide, persist into salesMemory, audit + metrics.
   * Does NOT execute commercial actions (schedule/send) — recommendation only.
   */
  async decideAndPersist(input: {
    companyId: string;
    conversationId: string;
    leadId?: string;
    intent?: AiIntent | null;
    actorUserId?: string | null;
  }): Promise<NbaDecisionResult> {
    const conv = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        companyId: input.companyId,
        deletedAt: null,
      },
      select: {
        id: true,
        metadata: true,
        agentPaused: true,
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
    const pending = await this.prisma.followUp.findFirst({
      where: {
        companyId: input.companyId,
        leadId,
        deletedAt: null,
        type: AI_RECOVERY_FOLLOWUP_TYPE,
        status: { in: [FollowUpStatus.SCHEDULED, FollowUpStatus.EXECUTING] },
      },
      select: { id: true },
    });

    const decided = this.decide({
      memory,
      leadStatus: conv.lead.status,
      agentPaused: conv.agentPaused,
      lastInboundAt: conv.lead.lastInboundAt,
      lastOutboundAt: conv.lead.lastOutboundAt,
      hasPendingRecovery: Boolean(pending),
      intent: input.intent,
    });

    const previous = memory.nextBestAction;
    const changed = previous !== decided.action;
    const at = new Date().toISOString();

    const nextMemory: SalesMemory = {
      ...memory,
      nextBestAction: decided.action,
      lastActionDecisionAt: at,
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

    await this.prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: conv.id },
        data: { metadata: nextMeta },
      });

      await this.audit.write(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId ?? null,
        action: NBA_DECIDED,
        targetType: 'CONVERSATION',
        targetId: conv.id,
        before: { nextBestAction: previous },
        after: {
          nextBestAction: decided.action,
          reason: decided.reason,
          replyGoal: decided.replyGoal,
          score: decided.score,
          temperature: decided.temperature,
          leadId,
          pipeline: NBA_PIPELINE,
        },
      });

      if (changed && previous != null) {
        await this.audit.write(tx, {
          companyId: input.companyId,
          actorUserId: input.actorUserId ?? null,
          action: NBA_CHANGED,
          targetType: 'CONVERSATION',
          targetId: conv.id,
          before: { nextBestAction: previous },
          after: {
            nextBestAction: decided.action,
            reason: decided.reason,
            leadId,
            pipeline: NBA_PIPELINE,
          },
        });
      }
    });

    this.prom?.recordNbaDecided(decided.action);
    if (changed && previous != null) {
      this.prom?.recordNbaChanged(decided.action);
    }

    this.logger.debug(
      `nba company=${input.companyId} conversation=${conv.id} action=${decided.action} changed=${changed}`,
    );

    return { ...decided, changed, previous };
  }

  /**
   * Enrich ASSIST/AUTO body with NBA guidance only — does not execute actions.
   * Emits NBA_EXECUTED (meaning “applied to reply composition”).
   */
  async markExecuted(input: {
    companyId: string;
    conversationId: string;
    action: NextBestActionCode;
    mode: 'ASSIST' | 'AUTO';
    followUpId?: string;
    actorUserId?: string | null;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.audit.write(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId ?? null,
        action: NBA_EXECUTED,
        targetType: 'CONVERSATION',
        targetId: input.conversationId,
        before: null,
        after: {
          nextBestAction: input.action,
          mode: input.mode,
          followUpId: input.followUpId ?? null,
          note: 'enriched_reply_only',
          pipeline: NBA_PIPELINE,
        },
      });
    });
    this.prom?.recordNbaExecuted(input.action);
  }

  enrichSuggestedBody(
    body: string,
    decision: Pick<NbaDecisionResult, 'action' | 'replyGoal'>,
  ): { body: string; enrichment: NbaEnrichment } {
    const enrichLine = this.enrichLineFor(decision.action, decision.replyGoal);
    const trimmed = (body ?? '').trim();
    // Avoid duplicating if already present.
    const next =
      trimmed.includes(enrichLine) ||
      trimmed.includes(`[NBA:${decision.action}]`)
        ? trimmed
        : `${trimmed}\n\n—\nPróximo passo sugerido (${decision.action}): ${decision.replyGoal}`;
    return {
      body: next.trim(),
      enrichment: {
        action: decision.action,
        replyGoal: decision.replyGoal,
        reason: decision.action,
        enrichLine,
      },
    };
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
        agentPaused: true,
        lead: {
          select: {
            status: true,
            lastInboundAt: true,
            lastOutboundAt: true,
            name: true,
          },
        },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    const memory = this.salesMemory.readFromMetadata(conv.metadata);
    const pending = await this.prisma.followUp.findFirst({
      where: {
        companyId: actor.cid,
        leadId: conv.leadId,
        deletedAt: null,
        type: AI_RECOVERY_FOLLOWUP_TYPE,
        status: { in: [FollowUpStatus.SCHEDULED, FollowUpStatus.EXECUTING] },
      },
      select: { id: true },
    });

    const live = this.decide({
      memory,
      leadStatus: conv.lead.status,
      agentPaused: conv.agentPaused,
      lastInboundAt: conv.lead.lastInboundAt,
      lastOutboundAt: conv.lead.lastOutboundAt,
      hasPendingRecovery: Boolean(pending),
    });

    return {
      companyId: actor.cid,
      conversationId: conv.id,
      leadId: conv.leadId,
      leadStatus: conv.lead.status,
      persisted: {
        nextBestAction: memory.nextBestAction,
        lastActionDecisionAt: memory.lastActionDecisionAt,
      },
      recommended: {
        action: live.action,
        reason: live.reason,
        replyGoal: live.replyGoal,
        score: live.score,
        temperature: live.temperature,
      },
      labels: this.labels(),
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
      where: {
        companyId: actor.cid,
        leadId,
        deletedAt: null,
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true },
    });

    if (!conv) {
      return {
        companyId: actor.cid,
        leadId,
        leadStatus: lead.status,
        conversationId: null,
        recommended: null,
        labels: this.labels(),
        readOnly: true,
      };
    }

    const detail = await this.getForConversation(actor, conv.id);
    return {
      companyId: actor.cid,
      leadId,
      leadStatus: lead.status,
      conversationId: conv.id,
      recommended: detail.recommended,
      persisted: detail.persisted,
      labels: this.labels(),
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

    const counts = Object.fromEntries(NBA_ACTIONS.map((a) => [a, 0])) as Record<
      NextBestActionCode,
      number
    >;
    const conversions = Object.fromEntries(
      NBA_ACTIONS.map((a) => [a, 0]),
    ) as Record<NextBestActionCode, number>;
    const byTemp = Object.fromEntries(
      NBA_ACTIONS.map((a) => [a, { HOT: 0, WARM: 0, COLD: 0 }]),
    ) as Record<
      NextBestActionCode,
      { HOT: number; WARM: number; COLD: number }
    >;

    let withNba = 0;
    for (const c of conversations) {
      const mem = this.salesMemory.readFromMetadata(c.metadata);
      const action = mem.nextBestAction;
      if (!action || !ACTION_SET.has(action)) continue;
      withNba += 1;
      counts[action] += 1;
      byTemp[action][mem.temperature] += 1;
      if (c.lead.status === LeadStatus.CONVERTED) {
        conversions[action] += 1;
      }
    }

    const topActions = (NBA_ACTIONS as readonly NextBestActionCode[])
      .map((action) => ({
        action,
        count: counts[action],
        conversions: conversions[action],
        temperatures: byTemp[action],
      }))
      .sort((a, b) => b.count - a.count);

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      topActions,
      conversionsByAction: conversions,
      temperaturesByAction: byTemp,
      conversationsWithNba: withNba,
      silenceDays: NBA_SILENCE_DAYS,
      pipeline: NBA_PIPELINE,
      labels: this.labels(),
    };
  }

  labels(): Record<NextBestActionCode, string> {
    return {
      ASK_BUDGET: 'Perguntar orçamento',
      ASK_CITY: 'Perguntar cidade',
      ASK_PAYMENT: 'Perguntar pagamento',
      ASK_PRODUCT: 'Perguntar produto',
      HANDLE_OBJECTION: 'Tratar objeção',
      OFFER_ALTERNATIVE: 'Oferecer alternativa',
      OFFER_CLOSE: 'Convidar ao fechamento',
      SCHEDULE_RECOVERY: 'Agendar recovery',
      ESCALATE_HUMAN: 'Escalar para humano',
      WAIT: 'Aguardar',
    };
  }

  private result(
    action: NextBestActionCode,
    reason: string,
    replyGoal: string,
    temperature: SalesTemperature,
    score: number,
  ) {
    return { action, reason, replyGoal, temperature, score };
  }

  private isSilentTooLong(
    lastInboundAt?: Date | null,
    lastOutboundAt?: Date | null,
  ): boolean {
    if (!lastOutboundAt) return false;
    const inbound = lastInboundAt?.getTime() ?? 0;
    const outbound = lastOutboundAt.getTime();
    if (inbound > outbound) return false;
    const days = (Date.now() - outbound) / (24 * 3600_000);
    return days >= NBA_SILENCE_DAYS;
  }

  private enrichLineFor(action: NextBestActionCode, replyGoal: string): string {
    return `[NBA:${action}] ${replyGoal}`;
  }
}
