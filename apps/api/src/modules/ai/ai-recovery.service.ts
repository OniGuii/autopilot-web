import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AiIntent,
  Channel,
  ConversationStatus,
  FollowUpStatus,
  LeadStatus,
  MessageDirection,
  WhatsAppConnectionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { RedisService } from '../../shared/redis/redis.service';
import {
  AI_RECOVERY_COMPANY_RATE_KEY_PREFIX,
  AI_RECOVERY_CONVERTED,
  AI_RECOVERY_CREATED,
  AI_RECOVERY_DEFAULT_CADENCE_HOURS,
  AI_RECOVERY_FOLLOWUP_TYPE,
  AI_RECOVERY_MAX_PER_COMPANY_PER_MINUTE,
  AI_RECOVERY_MESSAGE_SOURCE,
  AI_RECOVERY_PIPELINE,
  AI_RECOVERY_SENT,
  AI_RECOVERY_STOPPED,
} from './ai.constants';
import { AiRecoveryMessageService } from './ai-recovery-message.service';
import { AiRecoverySettingsService } from './ai-recovery-settings.service';

export type RecoveryStopReason =
  | 'REPLY'
  | 'CONVERTED'
  | 'LOST'
  | 'HUMAN_TAKEOVER'
  | 'MAX_ATTEMPTS'
  | 'DISABLED'
  | 'AGENT_MODE_OFF'
  | 'MANUAL';

type RecoveryMeta = {
  source: typeof AI_RECOVERY_MESSAGE_SOURCE;
  pipeline: typeof AI_RECOVERY_PIPELINE;
  recoveryAttempt: number;
  recoveryAnchorAt: string;
  intent: AiIntent | null;
  kbSource?: string | null;
  promptVersion?: string;
  stopReason?: RecoveryStopReason;
};

@Injectable()
export class AiRecoveryService {
  private readonly logger = new Logger(AiRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: AiRecoverySettingsService,
    private readonly messages: AiRecoveryMessageService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  /**
   * Scanner entry: find eligible leads for a company and schedule next AI_RECOVERY.
   */
  async scheduleEligibleForCompany(companyId: string): Promise<number> {
    const policy = await this.prisma.companyRecoverySettings.findFirst({
      where: { companyId, deletedAt: null, enabled: true },
    });
    if (!policy?.enabled) return 0;

    const agent = await this.prisma.companyAiSettings.findFirst({
      where: { companyId, deletedAt: null },
      select: { mode: true },
    });
    if (agent?.mode === 'OFF') return 0;

    const wa = await this.prisma.whatsAppInstance.findFirst({
      where: { companyId, deletedAt: null },
      select: { status: true },
    });
    if (!wa || wa.status !== WhatsAppConnectionStatus.CONNECTED) return 0;

    if (!(await this.withinAllowedHours(companyId, policy))) return 0;

    const leads = await this.prisma.lead.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: [LeadStatus.CONTACTED, LeadStatus.RESPONDED] },
        lastOutboundAt: { not: null },
      },
      select: {
        id: true,
        name: true,
        status: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        ownerId: true,
      },
      take: 80,
      orderBy: { lastOutboundAt: 'asc' },
    });

    let created = 0;
    for (const lead of leads) {
      try {
        const ok = await this.tryScheduleLead(companyId, lead, policy);
        if (ok) created += 1;
      } catch (err) {
        this.logger.warn(
          `recovery schedule failed lead=${lead.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    return created;
  }

  async tryScheduleLead(
    companyId: string,
    lead: {
      id: string;
      name: string | null;
      status: LeadStatus;
      lastInboundAt: Date | null;
      lastOutboundAt: Date | null;
      ownerId: string | null;
    },
    policy: {
      maxAttempts: number;
      cooldownHours: number;
      stopOnReply: boolean;
      stopOnHumanTakeover: boolean;
      cadenceHours: number[];
    },
  ): Promise<boolean> {
    if (!this.isEligibleStatus(lead.status)) return false;
    if (!lead.lastOutboundAt) return false;

    const pending = await this.prisma.followUp.findFirst({
      where: {
        companyId,
        leadId: lead.id,
        deletedAt: null,
        type: AI_RECOVERY_FOLLOWUP_TYPE,
        status: {
          in: [FollowUpStatus.SCHEDULED, FollowUpStatus.EXECUTING],
        },
      },
      select: { id: true },
    });
    if (pending) return false;

    const executed = await this.prisma.followUp.findMany({
      where: {
        companyId,
        leadId: lead.id,
        deletedAt: null,
        type: AI_RECOVERY_FOLLOWUP_TYPE,
        status: FollowUpStatus.EXECUTED,
      },
      orderBy: { executedAt: 'asc' },
      select: { id: true, executedAt: true, metadata: true },
    });

    const attemptIndex = executed.length; // 0 => R1
    if (attemptIndex >= policy.maxAttempts) {
      return false;
    }

    const cadence =
      policy.cadenceHours.length > 0
        ? policy.cadenceHours
        : [...AI_RECOVERY_DEFAULT_CADENCE_HOURS];
    if (attemptIndex >= cadence.length) return false;
    const delayHours = cadence[attemptIndex]!;

    const anchorAt = this.resolveAnchor(lead.lastOutboundAt, executed);
    if (policy.stopOnReply && this.hasReplySince(lead.lastInboundAt, anchorAt)) {
      return false;
    }

    // Cliente falou por último → não recuperar (respeita diálogo).
    if (
      lead.lastInboundAt &&
      lead.lastOutboundAt &&
      lead.lastInboundAt.getTime() > lead.lastOutboundAt.getTime()
    ) {
      return false;
    }

    if (executed.length > 0) {
      const lastExec = executed[executed.length - 1].executedAt;
      if (lastExec) {
        const cooled = new Date(
          lastExec.getTime() + policy.cooldownHours * 3600_000,
        );
        if (cooled.getTime() > Date.now()) return false;
      }
    }

    const dueAt = new Date(anchorAt.getTime() + delayHours * 3600_000);
    const scheduleAt =
      dueAt.getTime() > Date.now()
        ? dueAt
        : new Date(Date.now() + 30_000);

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        companyId,
        leadId: lead.id,
        deletedAt: null,
        status: { in: [ConversationStatus.OPEN, ConversationStatus.IDLE] },
      },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        assignedUserId: true,
        agentPaused: true,
      },
    });
    if (!conversation) return false;
    if (policy.stopOnHumanTakeover && conversation.agentPaused) return false;

    if (this.redis) {
      const key = `${AI_RECOVERY_COMPANY_RATE_KEY_PREFIX}${companyId}`;
      const n = await this.redis.incrWithExpire(key, 60);
      if (n === null || n > AI_RECOVERY_MAX_PER_COMPANY_PER_MINUTE) {
        return false;
      }
    }

    const intent = await this.resolveLastIntent(companyId, conversation.id);
    const draft = await this.messages.generate({
      companyId,
      leadId: lead.id,
      conversationId: conversation.id,
      attempt: attemptIndex + 1,
      intent,
      leadName: lead.name,
    });

    const metadata: RecoveryMeta = {
      source: AI_RECOVERY_MESSAGE_SOURCE,
      pipeline: AI_RECOVERY_PIPELINE,
      recoveryAttempt: attemptIndex + 1,
      recoveryAnchorAt: anchorAt.toISOString(),
      intent: draft.intent,
      kbSource: draft.kbSource,
      promptVersion: draft.promptVersion,
    };

    const followUp = await this.prisma.$transaction(async (tx) => {
      const created = await tx.followUp.create({
        data: {
          companyId,
          leadId: lead.id,
          conversationId: conversation.id,
          assignedUserId: conversation.assignedUserId ?? lead.ownerId,
          type: AI_RECOVERY_FOLLOWUP_TYPE,
          channel: Channel.WHATSAPP,
          status: FollowUpStatus.SCHEDULED,
          scheduledAt: scheduleAt,
          suggestedBody: draft.body,
          metadata,
        },
      });
      await this.audit.write(tx, {
        companyId,
        actorUserId: null,
        action: AI_RECOVERY_CREATED,
        targetType: 'FOLLOWUP',
        targetId: created.id,
        before: null,
        after: {
          leadId: lead.id,
          conversationId: conversation.id,
          attempt: attemptIndex + 1,
          intent: draft.intent,
          scheduledAt: created.scheduledAt?.toISOString() ?? null,
          pipeline: AI_RECOVERY_PIPELINE,
        },
      });
      return created;
    });

    this.prom?.recordAiRecoveryActiveDelta(1);
    this.logger.log(
      `recovery scheduled company=${companyId} lead=${lead.id} followUp=${followUp.id} attempt=${attemptIndex + 1} due=${scheduleAt.toISOString()}`,
    );
    return true;
  }

  isEligibleStatus(status: LeadStatus): boolean {
    return status === LeadStatus.CONTACTED || status === LeadStatus.RESPONDED;
  }

  /**
   * Before scheduler send: re-check stop conditions + regenerate body.
   */
  async prepareExecution(input: {
    companyId: string;
    followUpId: string;
  }): Promise<
    | { ok: true; suggestedBody: string }
    | { ok: false; reason: RecoveryStopReason }
  > {
    const followUp = await this.prisma.followUp.findFirst({
      where: {
        id: input.followUpId,
        companyId: input.companyId,
        deletedAt: null,
        type: AI_RECOVERY_FOLLOWUP_TYPE,
      },
    });
    if (!followUp) return { ok: false, reason: 'MANUAL' };

    const policy = await this.prisma.companyRecoverySettings.findFirst({
      where: { companyId: input.companyId, deletedAt: null },
    });
    if (!policy?.enabled) {
      await this.stopLeadRecovery(input.companyId, followUp.leadId, 'DISABLED');
      return { ok: false, reason: 'DISABLED' };
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: followUp.leadId, companyId: input.companyId, deletedAt: null },
    });
    if (!lead) return { ok: false, reason: 'MANUAL' };
    if (lead.status === LeadStatus.CONVERTED) {
      await this.stopLeadRecovery(input.companyId, lead.id, 'CONVERTED');
      return { ok: false, reason: 'CONVERTED' };
    }
    if (lead.status === LeadStatus.LOST) {
      await this.stopLeadRecovery(input.companyId, lead.id, 'LOST');
      return { ok: false, reason: 'LOST' };
    }
    if (!this.isEligibleStatus(lead.status)) {
      await this.stopLeadRecovery(input.companyId, lead.id, 'MANUAL');
      return { ok: false, reason: 'MANUAL' };
    }

    const meta = this.readMeta(followUp.metadata);
    const anchorAt = meta.recoveryAnchorAt
      ? new Date(meta.recoveryAnchorAt)
      : lead.lastOutboundAt ?? new Date(0);

    if (
      policy.stopOnReply &&
      this.hasReplySince(lead.lastInboundAt, anchorAt)
    ) {
      await this.stopLeadRecovery(input.companyId, lead.id, 'REPLY');
      return { ok: false, reason: 'REPLY' };
    }

    if (followUp.conversationId && policy.stopOnHumanTakeover) {
      const conv = await this.prisma.conversation.findFirst({
        where: {
          id: followUp.conversationId,
          companyId: input.companyId,
          deletedAt: null,
        },
        select: { agentPaused: true },
      });
      if (conv?.agentPaused) {
        await this.stopLeadRecovery(
          input.companyId,
          lead.id,
          'HUMAN_TAKEOVER',
        );
        return { ok: false, reason: 'HUMAN_TAKEOVER' };
      }
    }

    if (!followUp.conversationId) {
      await this.stopLeadRecovery(input.companyId, lead.id, 'MANUAL');
      return { ok: false, reason: 'MANUAL' };
    }

    const attempt = meta.recoveryAttempt ?? 1;
    const generated = await this.messages.generate({
      companyId: input.companyId,
      leadId: lead.id,
      conversationId: followUp.conversationId,
      attempt,
      intent: meta.intent,
      leadName: lead.name,
    });

    await this.prisma.followUp.update({
      where: { id: followUp.id },
      data: {
        suggestedBody: generated.body,
        metadata: {
          ...meta,
          intent: generated.intent,
          kbSource: generated.kbSource,
          promptVersion: generated.promptVersion,
        },
      },
    });

    return { ok: true, suggestedBody: generated.body };
  }

  async afterSent(input: {
    companyId: string;
    followUpId: string;
    messageId: string;
    correlationId: string;
  }): Promise<void> {
    const followUp = await this.prisma.followUp.findFirst({
      where: { id: input.followUpId, companyId: input.companyId },
    });
    if (!followUp) return;
    const meta = this.readMeta(followUp.metadata);

    await this.prisma.$transaction(async (tx) => {
      await this.audit.write(tx, {
        companyId: input.companyId,
        actorUserId: null,
        action: AI_RECOVERY_SENT,
        targetType: 'FOLLOWUP',
        targetId: followUp.id,
        before: null,
        after: {
          leadId: followUp.leadId,
          messageId: input.messageId,
          correlationId: input.correlationId,
          attempt: meta.recoveryAttempt ?? null,
          intent: meta.intent,
          pipeline: AI_RECOVERY_PIPELINE,
        },
      });
    });
    this.prom?.recordAiRecoverySent();
    this.prom?.recordAiRecoveryActiveDelta(-1);
  }

  async stopOnInboundReply(input: {
    companyId: string;
    leadId: string;
  }): Promise<void> {
    const policy = await this.prisma.companyRecoverySettings.findFirst({
      where: { companyId: input.companyId, deletedAt: null },
      select: { stopOnReply: true },
    });
    if (policy && policy.stopOnReply === false) return;
    await this.stopLeadRecovery(input.companyId, input.leadId, 'REPLY');
  }

  async stopOnHumanTakeover(input: {
    companyId: string;
    leadId: string;
  }): Promise<void> {
    const policy = await this.prisma.companyRecoverySettings.findFirst({
      where: { companyId: input.companyId, deletedAt: null },
      select: { stopOnHumanTakeover: true },
    });
    if (policy && policy.stopOnHumanTakeover === false) return;
    await this.stopLeadRecovery(input.companyId, input.leadId, 'HUMAN_TAKEOVER');
  }

  async stopOnLeadTerminal(input: {
    companyId: string;
    leadId: string;
    status: LeadStatus;
  }): Promise<void> {
    if (input.status === LeadStatus.CONVERTED) {
      await this.markConverted(input.companyId, input.leadId);
      return;
    }
    if (input.status === LeadStatus.LOST) {
      await this.stopLeadRecovery(input.companyId, input.leadId, 'LOST');
    }
  }

  async stopLeadRecovery(
    companyId: string,
    leadId: string,
    reason: RecoveryStopReason,
  ): Promise<number> {
    const pending = await this.prisma.followUp.findMany({
      where: {
        companyId,
        leadId,
        deletedAt: null,
        type: AI_RECOVERY_FOLLOWUP_TYPE,
        status: {
          in: [
            FollowUpStatus.SCHEDULED,
            FollowUpStatus.SUGGESTED,
            FollowUpStatus.APPROVED,
          ],
        },
      },
      select: { id: true, metadata: true, status: true },
    });
    if (pending.length === 0) return 0;

    await this.prisma.$transaction(async (tx) => {
      for (const fu of pending) {
        const meta = this.readMeta(fu.metadata);
        await tx.followUp.update({
          where: { id: fu.id },
          data: {
            status: FollowUpStatus.CANCELLED,
            cancelReason: `AI_RECOVERY_STOPPED:${reason}`,
            metadata: { ...meta, stopReason: reason },
          },
        });
        await this.audit.write(tx, {
          companyId,
          actorUserId: null,
          action: AI_RECOVERY_STOPPED,
          targetType: 'FOLLOWUP',
          targetId: fu.id,
          before: { status: fu.status },
          after: { status: FollowUpStatus.CANCELLED, reason, leadId },
        });
      }
    });

    this.prom?.recordAiRecoveryStopped(pending.length);
    this.prom?.recordAiRecoveryActiveDelta(-pending.length);
    return pending.length;
  }

  private async markConverted(companyId: string, leadId: string) {
    const hadRecovery = await this.prisma.followUp.findFirst({
      where: {
        companyId,
        leadId,
        deletedAt: null,
        type: AI_RECOVERY_FOLLOWUP_TYPE,
        status: FollowUpStatus.EXECUTED,
      },
      select: { id: true },
    });
    await this.stopLeadRecovery(companyId, leadId, 'CONVERTED');
    if (!hadRecovery) return;

    await this.prisma.$transaction(async (tx) => {
      await this.audit.write(tx, {
        companyId,
        actorUserId: null,
        action: AI_RECOVERY_CONVERTED,
        targetType: 'LEAD',
        targetId: leadId,
        before: null,
        after: {
          leadId,
          followUpId: hadRecovery.id,
          pipeline: AI_RECOVERY_PIPELINE,
        },
      });
    });
    this.prom?.recordAiRecoveryConverted();
  }

  private resolveAnchor(
    lastOutboundAt: Date,
    executed: Array<{ metadata: unknown; executedAt: Date | null }>,
  ): Date {
    for (const row of executed) {
      const meta = this.readMeta(row.metadata);
      if (meta.recoveryAnchorAt) return new Date(meta.recoveryAnchorAt);
    }
    return lastOutboundAt;
  }

  private hasReplySince(
    lastInboundAt: Date | null,
    anchorAt: Date,
  ): boolean {
    if (!lastInboundAt) return false;
    return lastInboundAt.getTime() > anchorAt.getTime();
  }

  private async resolveLastIntent(
    companyId: string,
    conversationId: string,
  ): Promise<AiIntent | null> {
    const msg = await this.prisma.message.findFirst({
      where: {
        companyId,
        conversationId,
        deletedAt: null,
        direction: MessageDirection.INBOUND,
      },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    const meta =
      msg?.metadata &&
      typeof msg.metadata === 'object' &&
      !Array.isArray(msg.metadata)
        ? (msg.metadata as { aiIntent?: { intent?: string } })
        : null;
    const intent = meta?.aiIntent?.intent;
    if (intent && Object.values(AiIntent).includes(intent as AiIntent)) {
      return intent as AiIntent;
    }
    return null;
  }

  private async withinAllowedHours(
    companyId: string,
    policy: {
      allowedHoursStart: number | null;
      allowedHoursEnd: number | null;
    },
  ): Promise<boolean> {
    if (policy.allowedHoursStart == null || policy.allowedHoursEnd == null) {
      return true;
    }
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { timezone: true },
    });
    const tz = company?.timezone || 'America/Sao_Paulo';
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: tz,
      }).format(new Date()),
    );
    return hour >= policy.allowedHoursStart && hour < policy.allowedHoursEnd;
  }

  private readMeta(metadata: unknown): RecoveryMeta & Record<string, unknown> {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return metadata as RecoveryMeta & Record<string, unknown>;
    }
    return {
      source: AI_RECOVERY_MESSAGE_SOURCE,
      pipeline: AI_RECOVERY_PIPELINE,
      recoveryAttempt: 1,
      recoveryAnchorAt: new Date(0).toISOString(),
      intent: null,
    };
  }
}
