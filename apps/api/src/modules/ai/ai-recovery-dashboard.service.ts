import { Injectable, Optional } from '@nestjs/common';
import { FollowUpStatus, LeadStatus } from '@prisma/client';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AI_RECOVERY_CONVERTED,
  AI_RECOVERY_FOLLOWUP_TYPE,
  AI_RECOVERY_STOPPED,
} from './ai.constants';
import { AiRecoverySettingsService } from './ai-recovery-settings.service';

type Actor = { cid: string; sub: string };

@Injectable()
export class AiRecoveryDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiRecoverySettingsService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  async getOverview(actor: Actor) {
    const companyId = actor.cid;
    const policy = await this.settings.getOrCreate(actor);

    const [
      activeScheduled,
      attemptsSent,
      stoppedAudits,
      convertedAudits,
      recoveredLeads,
    ] = await Promise.all([
      this.prisma.followUp.count({
        where: {
          companyId,
          deletedAt: null,
          type: AI_RECOVERY_FOLLOWUP_TYPE,
          status: {
            in: [FollowUpStatus.SCHEDULED, FollowUpStatus.EXECUTING],
          },
        },
      }),
      this.prisma.followUp.count({
        where: {
          companyId,
          deletedAt: null,
          type: AI_RECOVERY_FOLLOWUP_TYPE,
          status: FollowUpStatus.EXECUTED,
        },
      }),
      this.prisma.auditLog.count({
        where: { companyId, action: AI_RECOVERY_STOPPED },
      }),
      this.prisma.auditLog.count({
        where: { companyId, action: AI_RECOVERY_CONVERTED },
      }),
      this.countRecoveredLeads(companyId),
    ]);

    const touchedLeadIds = await this.prisma.followUp.findMany({
      where: {
        companyId,
        deletedAt: null,
        type: AI_RECOVERY_FOLLOWUP_TYPE,
        status: FollowUpStatus.EXECUTED,
      },
      distinct: ['leadId'],
      select: { leadId: true },
    });
    const touched = touchedLeadIds.length;
    const conversionRate =
      touched === 0
        ? null
        : Number((convertedAudits / touched).toFixed(4));

    // MVP revenue proxy: sum of lead.score for converted recovery leads.
    const convertedLeads = await this.prisma.lead.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: LeadStatus.CONVERTED,
        id: { in: touchedLeadIds.map((t) => t.leadId) },
      },
      select: { score: true },
    });
    const revenueRecovery = convertedLeads.reduce(
      (sum, l) => sum + (l.score ?? 0),
      0,
    );

    this.prom?.setAiRecoveryConversionRate(conversionRate);

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      policy: {
        enabled: policy.enabled,
        maxAttempts: policy.maxAttempts,
        cooldownHours: policy.cooldownHours,
        cadenceHours: policy.cadenceHours,
      },
      metrics: {
        leadsInRecovery: activeScheduled,
        attempts: attemptsSent,
        recovered: recoveredLeads,
        converted: convertedAudits,
        stopped: stoppedAudits,
        conversionRate,
        revenueRecovery,
      },
    };
  }

  /** Lead received AI_RECOVERY then produced inbound within 7 days. */
  private async countRecoveredLeads(companyId: string): Promise<number> {
    const sent = await this.prisma.followUp.findMany({
      where: {
        companyId,
        deletedAt: null,
        type: AI_RECOVERY_FOLLOWUP_TYPE,
        status: FollowUpStatus.EXECUTED,
        executedAt: { not: null },
      },
      select: { leadId: true, executedAt: true },
    });
    if (sent.length === 0) return 0;

    let recovered = 0;
    const seen = new Set<string>();
    for (const row of sent) {
      if (!row.executedAt || seen.has(row.leadId)) continue;
      const windowEnd = new Date(
        row.executedAt.getTime() + 7 * 24 * 3600_000,
      );
      const reply = await this.prisma.lead.findFirst({
        where: {
          id: row.leadId,
          companyId,
          deletedAt: null,
          lastInboundAt: { gt: row.executedAt, lte: windowEnd },
        },
        select: { id: true },
      });
      if (reply) {
        seen.add(row.leadId);
        recovered += 1;
      }
    }
    return recovered;
  }
}
