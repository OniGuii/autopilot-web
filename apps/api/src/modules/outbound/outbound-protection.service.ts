import {
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { LeadStatus, MessageDirection } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import {
  isProactiveOutboundSource,
  OUTBOUND_BLOCK_REASONS,
  OUTBOUND_PROACTIVE_BLOCKED,
  OUTBOUND_PROACTIVE_SOURCES,
  type OutboundBlockReason,
} from './outbound.constants';
import { OutboundProtectionSettingsService } from './outbound-protection-settings.service';
import { OutboundSuppressService } from './outbound-suppress.service';

export type ProactiveGuardInput = {
  companyId: string;
  leadId: string;
  source: string;
  /** When true, write OUTBOUND_PROACTIVE_BLOCKED audit (send-path). */
  auditOnBlock?: boolean;
};

export type ProactiveGuardResult =
  | { allowed: true; remainingDaily: number; remainingHourly: number }
  | {
      allowed: false;
      reason: OutboundBlockReason | 'LEAD_NOT_FOUND';
      remainingDaily?: number;
      remainingHourly?: number;
    };

@Injectable()
export class OutboundProtectionService {
  private readonly logger = new Logger(OutboundProtectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: OutboundProtectionSettingsService,
    private readonly suppress: OutboundSuppressService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  /**
   * Hard gate for proactive outbound sources.
   * Suppress always applies. Caps/cooldown/hours apply when settings.enabled.
   */
  async canSendProactive(
    input: ProactiveGuardInput,
  ): Promise<ProactiveGuardResult> {
    if (!isProactiveOutboundSource(input.source)) {
      return { allowed: true, remainingDaily: -1, remainingHourly: -1 };
    }

    const policy = await this.settings.getOrCreate({
      cid: input.companyId,
      sub: 'system',
    });

    const lead = await this.prisma.lead.findFirst({
      where: {
        id: input.leadId,
        companyId: input.companyId,
        deletedAt: null,
      },
      select: { id: true, phone: true, status: true },
    });
    if (!lead) {
      return this.block(input, 'LEAD_NOT_FOUND', policy.dailyProactiveCap, 0);
    }

    if (lead.status === LeadStatus.LOST) {
      return this.block(
        input,
        OUTBOUND_BLOCK_REASONS.LEAD_LOST,
        policy.dailyProactiveCap,
        0,
      );
    }
    if (lead.status === LeadStatus.CONVERTED) {
      return this.block(
        input,
        OUTBOUND_BLOCK_REASONS.LEAD_CONVERTED,
        policy.dailyProactiveCap,
        0,
      );
    }

    if (await this.suppress.isSuppressed(input.companyId, lead.phone)) {
      return this.block(
        input,
        OUTBOUND_BLOCK_REASONS.SUPPRESSED,
        policy.dailyProactiveCap,
        0,
      );
    }

    const usage = await this.countProactiveUsage(input.companyId);
    const remainingDaily = Math.max(
      0,
      policy.dailyProactiveCap - usage.dailyCount,
    );
    const remainingHourly = Math.max(
      0,
      policy.hourlyProactiveCap - usage.hourlyCount,
    );

    if (!policy.enabled) {
      this.prom?.recordOutboundProtectionAllowed('caps_disabled');
      return { allowed: true, remainingDaily, remainingHourly };
    }

    if (usage.dailyCount >= policy.dailyProactiveCap) {
      return this.block(
        input,
        OUTBOUND_BLOCK_REASONS.DAILY_CAP,
        remainingDaily,
        remainingHourly,
      );
    }
    if (usage.hourlyCount >= policy.hourlyProactiveCap) {
      return this.block(
        input,
        OUTBOUND_BLOCK_REASONS.HOURLY_CAP,
        remainingDaily,
        remainingHourly,
      );
    }

    const inHours = await this.isWithinAllowedHours(input.companyId, {
      allowedHoursStart: policy.allowedHoursStart,
      allowedHoursEnd: policy.allowedHoursEnd,
    });
    if (!inHours) {
      return this.block(
        input,
        OUTBOUND_BLOCK_REASONS.OUTSIDE_ALLOWED_HOURS,
        remainingDaily,
        remainingHourly,
      );
    }

    if (policy.leadCooldownMinutes > 0) {
      const since = new Date(Date.now() - policy.leadCooldownMinutes * 60_000);
      const recentLead = await this.findRecentProactive({
        companyId: input.companyId,
        leadId: input.leadId,
        since,
      });
      if (recentLead) {
        return this.block(
          input,
          OUTBOUND_BLOCK_REASONS.LEAD_COOLDOWN,
          remainingDaily,
          remainingHourly,
        );
      }
    }

    if (policy.minSpacingSeconds > 0) {
      const since = new Date(Date.now() - policy.minSpacingSeconds * 1000);
      const recentCompany = await this.findRecentProactive({
        companyId: input.companyId,
        since,
      });
      if (recentCompany) {
        return this.block(
          input,
          OUTBOUND_BLOCK_REASONS.MIN_SPACING,
          remainingDaily,
          remainingHourly,
        );
      }
    }

    this.prom?.recordOutboundProtectionAllowed(input.source);
    this.prom?.setOutboundProactiveRemainingDaily(remainingDaily - 1);
    this.prom?.setOutboundProactiveRemainingHourly(remainingHourly - 1);
    return {
      allowed: true,
      remainingDaily: remainingDaily - 1,
      remainingHourly: remainingHourly - 1,
    };
  }

  async assertCanSendProactive(input: ProactiveGuardInput): Promise<void> {
    const result = await this.canSendProactive({
      ...input,
      auditOnBlock: input.auditOnBlock ?? true,
    });
    if (!result.allowed) {
      throw new ConflictException(
        `Outbound protection blocked: ${result.reason}`,
      );
    }
  }

  private async block(
    input: ProactiveGuardInput,
    reason: OutboundBlockReason | 'LEAD_NOT_FOUND',
    remainingDaily: number,
    remainingHourly: number,
  ): Promise<ProactiveGuardResult> {
    this.prom?.recordOutboundProtectionBlocked(reason);
    this.logger.warn(
      `outbound blocked company=${input.companyId} lead=${input.leadId} source=${input.source} reason=${reason}`,
    );
    if (input.auditOnBlock) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.audit.write(tx, {
            companyId: input.companyId,
            actorUserId: null,
            action: OUTBOUND_PROACTIVE_BLOCKED,
            targetType: 'LEAD',
            targetId: input.leadId,
            before: null,
            after: {
              reason,
              source: input.source,
              remainingDaily,
              remainingHourly,
            },
          });
        });
      } catch (err) {
        this.logger.warn(
          `outbound block audit failed: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    return {
      allowed: false,
      reason,
      remainingDaily,
      remainingHourly,
    };
  }

  private async countProactiveUsage(companyId: string): Promise<{
    dailyCount: number;
    hourlyCount: number;
  }> {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const hourStart = new Date();
    hourStart.setMinutes(0, 0, 0);

    const sourceOr = OUTBOUND_PROACTIVE_SOURCES.map((source) => ({
      metadata: { path: ['source'], equals: source },
    }));

    const base = {
      companyId,
      deletedAt: null,
      direction: MessageDirection.OUTBOUND,
      OR: sourceOr,
    };

    const [dailyCount, hourlyCount] = await Promise.all([
      this.prisma.message.count({
        where: { ...base, createdAt: { gte: dayStart } },
      }),
      this.prisma.message.count({
        where: { ...base, createdAt: { gte: hourStart } },
      }),
    ]);

    return { dailyCount, hourlyCount };
  }

  private async findRecentProactive(input: {
    companyId: string;
    leadId?: string;
    since: Date;
  }) {
    const sourceOr = OUTBOUND_PROACTIVE_SOURCES.map((source) => ({
      metadata: { path: ['source'], equals: source },
    }));
    return this.prisma.message.findFirst({
      where: {
        companyId: input.companyId,
        deletedAt: null,
        direction: MessageDirection.OUTBOUND,
        createdAt: { gte: input.since },
        OR: sourceOr,
        ...(input.leadId
          ? { conversation: { leadId: input.leadId, deletedAt: null } }
          : {}),
      },
      select: { id: true },
    });
  }

  private async isWithinAllowedHours(
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
}
