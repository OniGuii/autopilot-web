import { Injectable } from '@nestjs/common';
import {
  ConversationStatus,
  FollowUpStatus,
  LeadStatus,
  MessageDirection,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

type CompanyActor = AuthenticatedUser & { cid: string };

const LEAD_STATUSES = Object.values(LeadStatus);

export type DashboardPeriod = {
  from: string | null;
  to: string | null;
};

export type OverviewKpis = {
  totalLeads: number;
  newLeads: number;
  convertedLeads: number;
  lostLeads: number;
  conversionRate: number;
  period: DashboardPeriod;
};

export type LeadsKpis = {
  byStatus: Record<LeadStatus, number>;
  period: DashboardPeriod;
};

export type ConversationsKpis = {
  openConversations: number;
  closedConversations: number;
  messagesSent: number;
  messagesReceived: number;
  avgMessagesPerConversation: number;
  period: DashboardPeriod;
};

export type FollowUpsKpis = {
  pending: number;
  overdue: number;
  executed: number;
  executionRate: number;
  period: DashboardPeriod;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getFull(actor: CompanyActor, query: DashboardQueryDto) {
    const [overview, leads, conversations, followUps] = await Promise.all([
      this.getOverview(actor, query),
      this.getLeads(actor, query),
      this.getConversations(actor, query),
      this.getFollowUps(actor, query),
    ]);

    return {
      companyId: actor.cid,
      generatedAt: new Date().toISOString(),
      period: this.periodMeta(query),
      overview,
      leads: {
        byStatus: leads.byStatus,
        period: leads.period,
      },
      conversations,
      followUps,
    };
  }

  async getOverview(
    actor: CompanyActor,
    query: DashboardQueryDto,
  ): Promise<OverviewKpis> {
    const companyId = actor.cid;
    const createdAt = this.createdAtFilter(query);
    const base: Prisma.LeadWhereInput = {
      companyId,
      deletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    };

    const [totalLeads, newLeads, convertedLeads, lostLeads] = await Promise.all(
      [
        this.prisma.lead.count({ where: base }),
        this.prisma.lead.count({
          where: { ...base, status: LeadStatus.NEW },
        }),
        this.prisma.lead.count({
          where: { ...base, status: LeadStatus.CONVERTED },
        }),
        this.prisma.lead.count({
          where: { ...base, status: LeadStatus.LOST },
        }),
      ],
    );

    return {
      totalLeads,
      newLeads,
      convertedLeads,
      lostLeads,
      conversionRate: this.rate(convertedLeads, totalLeads),
      period: this.periodMeta(query),
    };
  }

  async getLeads(
    actor: CompanyActor,
    query: DashboardQueryDto,
  ): Promise<LeadsKpis> {
    const companyId = actor.cid;
    const createdAt = this.createdAtFilter(query);

    const grouped = await this.prisma.lead.groupBy({
      by: ['status'],
      where: {
        companyId,
        deletedAt: null,
        ...(createdAt ? { createdAt } : {}),
      },
      _count: { _all: true },
    });

    const byStatus = Object.fromEntries(
      LEAD_STATUSES.map((status) => [status, 0]),
    ) as Record<LeadStatus, number>;

    for (const row of grouped) {
      byStatus[row.status] = row._count._all;
    }

    return {
      byStatus,
      period: this.periodMeta(query),
    };
  }

  async getConversations(
    actor: CompanyActor,
    query: DashboardQueryDto,
  ): Promise<ConversationsKpis> {
    const companyId = actor.cid;
    const createdAt = this.createdAtFilter(query);

    const conversationBase: Prisma.ConversationWhereInput = {
      companyId,
      deletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    };

    const messageBase: Prisma.MessageWhereInput = {
      companyId,
      deletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    };

    const [
      openConversations,
      closedConversations,
      messagesSent,
      messagesReceived,
      totalConversations,
    ] = await Promise.all([
      this.prisma.conversation.count({
        where: {
          ...conversationBase,
          status: {
            in: [ConversationStatus.OPEN, ConversationStatus.IDLE],
          },
        },
      }),
      this.prisma.conversation.count({
        where: {
          ...conversationBase,
          status: {
            in: [ConversationStatus.CLOSED, ConversationStatus.ARCHIVED],
          },
        },
      }),
      this.prisma.message.count({
        where: { ...messageBase, direction: MessageDirection.OUTBOUND },
      }),
      this.prisma.message.count({
        where: { ...messageBase, direction: MessageDirection.INBOUND },
      }),
      this.prisma.conversation.count({ where: conversationBase }),
    ]);

    const totalMessages = messagesSent + messagesReceived;

    return {
      openConversations,
      closedConversations,
      messagesSent,
      messagesReceived,
      avgMessagesPerConversation: this.rate(totalMessages, totalConversations),
      period: this.periodMeta(query),
    };
  }

  async getFollowUps(
    actor: CompanyActor,
    query: DashboardQueryDto,
  ): Promise<FollowUpsKpis> {
    const companyId = actor.cid;
    const createdAt = this.createdAtFilter(query);
    const now = new Date();

    const periodBase: Prisma.FollowUpWhereInput = {
      companyId,
      deletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    };

    // overdue ignores period (frozen decision)
    const overdueWhere: Prisma.FollowUpWhereInput = {
      companyId,
      deletedAt: null,
      status: {
        in: [FollowUpStatus.APPROVED, FollowUpStatus.SCHEDULED],
      },
      scheduledAt: { lt: now, not: null },
    };

    const [pending, overdue, executed] = await Promise.all([
      this.prisma.followUp.count({
        where: {
          ...periodBase,
          status: {
            in: [
              FollowUpStatus.SUGGESTED,
              FollowUpStatus.APPROVED,
              FollowUpStatus.SCHEDULED,
            ],
          },
        },
      }),
      this.prisma.followUp.count({ where: overdueWhere }),
      this.prisma.followUp.count({
        where: { ...periodBase, status: FollowUpStatus.EXECUTED },
      }),
    ]);

    return {
      pending,
      overdue,
      executed,
      executionRate: this.rate(executed, executed + pending),
      period: this.periodMeta(query),
    };
  }

  private createdAtFilter(
    query: DashboardQueryDto,
  ): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.to) return undefined;
    const filter: Prisma.DateTimeFilter = {};
    if (query.from) filter.gte = query.from;
    if (query.to) filter.lte = query.to;
    return filter;
  }

  private periodMeta(query: DashboardQueryDto): DashboardPeriod {
    return {
      from: query.from ? query.from.toISOString() : null,
      to: query.to ? query.to.toISOString() : null,
    };
  }

  /** Avoid division by zero; round to 4 decimal places. */
  private rate(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 10000) / 10000;
  }
}
