import { Injectable } from '@nestjs/common';
import { LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { DashboardQueryDto } from '../dashboard/dto/dashboard-query.dto';

type CompanyActor = AuthenticatedUser & { cid: string };

const LEAD_STATUSES = Object.values(LeadStatus);
const FUNNEL_STAGES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.RESPONDED,
  LeadStatus.QUALIFIED,
];

export type PipelineResponse = {
  companyId: string;
  generatedAt: string;
  period: { from: string | null; to: string | null };
  leadsByStage: Record<LeadStatus, number>;
  conversionByStage: Record<string, number> | null;
  avgTimeInStageMs: Record<string, number | null> | null;
  leadsWithoutContact: number;
  leadsUnassigned: number;
};

@Injectable()
export class PipelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getPipeline(
    actor: CompanyActor,
    query: DashboardQueryDto = {},
  ): Promise<PipelineResponse> {
    const companyId = actor.cid;
    const createdAt = this.createdAtFilter(query);
    const leadWhere: Prisma.LeadWhereInput = {
      companyId,
      deletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    };

    const [grouped, leadsWithoutContact, leadsUnassigned, transitions] =
      await Promise.all([
        this.prisma.lead.groupBy({
          by: ['status'],
          where: leadWhere,
          _count: { _all: true },
        }),
        this.prisma.lead.count({
          where: { ...leadWhere, lastContactAt: null },
        }),
        this.prisma.lead.count({
          where: { ...leadWhere, ownerId: null },
        }),
        this.prisma.leadStatusTransition.findMany({
          where: {
            companyId,
            ...(createdAt
              ? {
                  lead: {
                    deletedAt: null,
                    createdAt,
                  },
                }
              : {}),
          },
          orderBy: [{ leadId: 'asc' }, { createdAt: 'asc' }],
          select: {
            leadId: true,
            fromStatus: true,
            toStatus: true,
            createdAt: true,
          },
        }),
      ]);

    const leadsByStage = Object.fromEntries(
      LEAD_STATUSES.map((s) => [s, 0]),
    ) as Record<LeadStatus, number>;
    for (const row of grouped) {
      leadsByStage[row.status] = row._count._all;
    }

    let conversionByStage: Record<string, number> | null = null;
    let avgTimeInStageMs: Record<string, number | null> | null = null;

    if (transitions.length > 0) {
      conversionByStage = this.computeConversion(transitions);
      avgTimeInStageMs = this.computeAvgTime(transitions, leadsByStage);
    }

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      period: {
        from: query.from?.toISOString() ?? null,
        to: query.to?.toISOString() ?? null,
      },
      leadsByStage,
      conversionByStage,
      avgTimeInStageMs,
      leadsWithoutContact,
      leadsUnassigned,
    };
  }

  private computeConversion(
    transitions: Array<{ leadId: string; toStatus: LeadStatus }>,
  ): Record<string, number> {
    const entered = new Map<LeadStatus, Set<string>>();
    const converted = new Set<string>();

    for (const t of transitions) {
      if (!entered.has(t.toStatus)) {
        entered.set(t.toStatus, new Set());
      }
      entered.get(t.toStatus)!.add(t.leadId);
      if (t.toStatus === LeadStatus.CONVERTED) {
        converted.add(t.leadId);
      }
    }

    const result: Record<string, number> = {};
    for (const stage of FUNNEL_STAGES) {
      const leads = entered.get(stage);
      if (!leads || leads.size === 0) {
        result[stage] = 0;
        continue;
      }
      let n = 0;
      for (const leadId of leads) {
        if (converted.has(leadId)) n += 1;
      }
      result[stage] = n / leads.size;
    }
    return result;
  }

  private computeAvgTime(
    transitions: Array<{
      leadId: string;
      toStatus: LeadStatus;
      createdAt: Date;
    }>,
    leadsByStage: Record<LeadStatus, number>,
  ): Record<string, number | null> {
    const byLead = new Map<
      string,
      Array<{ toStatus: LeadStatus; createdAt: Date }>
    >();
    for (const t of transitions) {
      const list = byLead.get(t.leadId) ?? [];
      list.push({ toStatus: t.toStatus, createdAt: t.createdAt });
      byLead.set(t.leadId, list);
    }

    const sums = new Map<LeadStatus, { total: number; count: number }>();
    const now = Date.now();

    for (const [, list] of byLead) {
      list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (let i = 0; i < list.length; i++) {
        const current = list[i];
        const next = list[i + 1];
        const endMs = next ? next.createdAt.getTime() : now;
        const duration = Math.max(0, endMs - current.createdAt.getTime());
        const bucket = sums.get(current.toStatus) ?? { total: 0, count: 0 };
        bucket.total += duration;
        bucket.count += 1;
        sums.set(current.toStatus, bucket);
      }
    }

    const result: Record<string, number | null> = {};
    for (const stage of LEAD_STATUSES) {
      const bucket = sums.get(stage);
      if (!bucket || bucket.count === 0) {
        result[stage] = leadsByStage[stage] > 0 ? null : null;
        continue;
      }
      result[stage] = Math.round(bucket.total / bucket.count);
    }
    return result;
  }

  private createdAtFilter(
    query: DashboardQueryDto,
  ): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.to) return undefined;
    return {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }
}
