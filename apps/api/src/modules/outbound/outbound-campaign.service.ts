import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { FollowUpStatus, LeadStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { OutboundFirstTouchService } from './outbound-first-touch.service';
import { OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE } from './outbound-first-touch.constants';
import {
  AddCampaignLeadsDto,
  AttachImportBatchDto,
  GenerateCampaignFirstTouchDto,
  RemoveCampaignLeadsDto,
} from './dto/campaign-leads.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import {
  CAMPAIGN_ADD_LEADS_MAX,
  CAMPAIGN_ARCHIVED,
  CAMPAIGN_COMPLETED,
  CAMPAIGN_CREATED,
  CAMPAIGN_HOT_SCORE_THRESHOLD,
  CAMPAIGN_LEADS_ADDED,
  CAMPAIGN_LEADS_REMOVED,
  CAMPAIGN_PAUSED,
  CAMPAIGN_STARTED,
  CAMPAIGN_STATUSES,
  CAMPAIGN_UPDATED,
  OUTBOUND_CAMPAIGN_PIPELINE,
  type CampaignStatus,
} from './outbound-campaign.constants';

type Actor = { cid: string; sub: string };
type ReqMeta = { ip?: string; userAgent?: string };

const EDITABLE_STATUSES: CampaignStatus[] = [
  CAMPAIGN_STATUSES.DRAFT,
  CAMPAIGN_STATUSES.READY,
  CAMPAIGN_STATUSES.RUNNING,
  CAMPAIGN_STATUSES.PAUSED,
];

@Injectable()
export class OutboundCampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly firstTouch: OutboundFirstTouchService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  async create(actor: Actor, dto: CreateCampaignDto, meta?: ReqMeta) {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.outboundCampaign.create({
        data: {
          companyId: actor.cid,
          createdByUserId: actor.sub,
          name: dto.name.trim(),
          objective: dto.objective.trim(),
          description: dto.description?.trim() || null,
          status: CAMPAIGN_STATUSES.DRAFT,
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: CAMPAIGN_CREATED,
        targetType: 'OUTBOUND_CAMPAIGN',
        targetId: created.id,
        before: null,
        after: this.serialize(created, 0),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return created;
    });
    this.prom?.recordCampaignCreated();
    return this.serialize(row, 0);
  }

  async list(
    actor: Actor,
    query: { status?: string; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where: Prisma.OutboundCampaignWhereInput = {
      companyId: actor.cid,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.outboundCampaign.count({ where }),
      this.prisma.outboundCampaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const withMetrics = await Promise.all(
      items.map(async (c) => {
        const metrics = await this.computeMetrics(actor.cid, c.id);
        return {
          ...this.serialize(c, metrics.totalLeads),
          metrics,
        };
      }),
    );

    const replyRates = withMetrics.map((c) => c.metrics.replyRate);
    if (replyRates.length > 0) {
      const avg =
        replyRates.reduce((a, b) => a + b, 0) / replyRates.length;
      this.prom?.setCampaignReplyRate(avg);
    }

    return {
      items: withMetrics,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getById(actor: Actor, id: string) {
    const campaign = await this.findCampaign(actor.cid, id);
    const metrics = await this.computeMetrics(actor.cid, id);
    return {
      ...this.serialize(campaign, metrics.totalLeads),
      metrics,
    };
  }

  async update(
    actor: Actor,
    id: string,
    dto: UpdateCampaignDto,
    meta?: ReqMeta,
  ) {
    const existing = await this.findCampaign(actor.cid, id);
    if (!EDITABLE_STATUSES.includes(existing.status as CampaignStatus)) {
      throw new ConflictException(
        `Cannot edit campaign in status ${existing.status}`,
      );
    }
    if (existing.status === CAMPAIGN_STATUSES.ARCHIVED) {
      throw new ConflictException('Cannot edit archived campaign');
    }

    const before = this.serialize(existing, await this.countLeads(actor.cid, id));
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.outboundCampaign.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.objective !== undefined
            ? { objective: dto.objective.trim() }
            : {}),
          ...(dto.description !== undefined
            ? {
                description:
                  dto.description === null ? null : dto.description.trim(),
              }
            : {}),
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: CAMPAIGN_UPDATED,
        targetType: 'OUTBOUND_CAMPAIGN',
        targetId: updated.id,
        before,
        after: this.serialize(updated, before.leadCount),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return updated;
    });
    return this.serialize(row, before.leadCount);
  }

  async transition(
    actor: Actor,
    id: string,
    action: 'ready' | 'start' | 'pause' | 'resume' | 'complete' | 'archive',
    meta?: ReqMeta,
  ) {
    const existing = await this.findCampaign(actor.cid, id);
    const from = existing.status as CampaignStatus;
    const now = new Date();

    let to: CampaignStatus;
    let auditAction: string;
    const data: Prisma.OutboundCampaignUpdateInput = {};

    switch (action) {
      case 'ready':
        if (from !== CAMPAIGN_STATUSES.DRAFT) {
          throw new ConflictException('Only DRAFT can move to READY');
        }
        to = CAMPAIGN_STATUSES.READY;
        auditAction = CAMPAIGN_UPDATED;
        data.status = to;
        break;
      case 'start':
        if (
          from !== CAMPAIGN_STATUSES.READY &&
          from !== CAMPAIGN_STATUSES.PAUSED
        ) {
          throw new ConflictException('Only READY or PAUSED can start/resume');
        }
        to = CAMPAIGN_STATUSES.RUNNING;
        auditAction = CAMPAIGN_STARTED;
        data.status = to;
        data.startedAt = existing.startedAt ?? now;
        data.pausedAt = null;
        break;
      case 'pause':
        if (from !== CAMPAIGN_STATUSES.RUNNING) {
          throw new ConflictException('Only RUNNING can be paused');
        }
        to = CAMPAIGN_STATUSES.PAUSED;
        auditAction = CAMPAIGN_PAUSED;
        data.status = to;
        data.pausedAt = now;
        break;
      case 'resume':
        if (from !== CAMPAIGN_STATUSES.PAUSED) {
          throw new ConflictException('Only PAUSED can resume');
        }
        to = CAMPAIGN_STATUSES.RUNNING;
        auditAction = CAMPAIGN_STARTED;
        data.status = to;
        data.pausedAt = null;
        break;
      case 'complete':
        if (
          from !== CAMPAIGN_STATUSES.RUNNING &&
          from !== CAMPAIGN_STATUSES.PAUSED
        ) {
          throw new ConflictException(
            'Only RUNNING or PAUSED can be completed',
          );
        }
        to = CAMPAIGN_STATUSES.COMPLETED;
        auditAction = CAMPAIGN_COMPLETED;
        data.status = to;
        data.completedAt = now;
        break;
      case 'archive':
        if (from === CAMPAIGN_STATUSES.ARCHIVED) {
          throw new ConflictException('Already archived');
        }
        to = CAMPAIGN_STATUSES.ARCHIVED;
        auditAction = CAMPAIGN_ARCHIVED;
        data.status = to;
        data.archivedAt = now;
        break;
      default:
        throw new BadRequestException('Unknown transition');
    }

    const leadCount = await this.countLeads(actor.cid, id);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.outboundCampaign.update({
        where: { id },
        data,
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: auditAction,
        targetType: 'OUTBOUND_CAMPAIGN',
        targetId: updated.id,
        before: { status: from },
        after: {
          status: to,
          pipeline: OUTBOUND_CAMPAIGN_PIPELINE,
        },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return updated;
    });
    return this.serialize(row, leadCount);
  }

  async addLeads(
    actor: Actor,
    id: string,
    dto: AddCampaignLeadsDto,
    meta?: ReqMeta,
  ) {
    const campaign = await this.findCampaign(actor.cid, id);
    this.assertMembershipMutable(campaign.status);

    const uniqueIds = [...new Set(dto.leadIds)];
    if (uniqueIds.length > CAMPAIGN_ADD_LEADS_MAX) {
      throw new BadRequestException(
        `Max ${CAMPAIGN_ADD_LEADS_MAX} leads per request`,
      );
    }

    const leads = await this.prisma.lead.findMany({
      where: {
        companyId: actor.cid,
        id: { in: uniqueIds },
        deletedAt: null,
      },
      select: { id: true, metadata: true },
    });
    if (leads.length !== uniqueIds.length) {
      throw new BadRequestException('One or more leads not found in company');
    }

    let added = 0;
    let skipped = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const lead of leads) {
        const existing = await tx.outboundCampaignLead.findFirst({
          where: {
            companyId: actor.cid,
            campaignId: id,
            leadId: lead.id,
            deletedAt: null,
          },
        });
        if (existing) {
          skipped += 1;
          continue;
        }
        const soft = await tx.outboundCampaignLead.findFirst({
          where: {
            companyId: actor.cid,
            campaignId: id,
            leadId: lead.id,
            deletedAt: { not: null },
          },
        });
        if (soft) {
          await tx.outboundCampaignLead.update({
            where: { id: soft.id },
            data: { deletedAt: null, addedAt: new Date() },
          });
        } else {
          await tx.outboundCampaignLead.create({
            data: {
              companyId: actor.cid,
              campaignId: id,
              leadId: lead.id,
            },
          });
        }
        await this.stampLeadCampaignMetadata(tx, lead.id, lead.metadata, id);
        added += 1;
      }
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: CAMPAIGN_LEADS_ADDED,
        targetType: 'OUTBOUND_CAMPAIGN',
        targetId: id,
        before: null,
        after: { added, skipped, pipeline: OUTBOUND_CAMPAIGN_PIPELINE },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
    });

    if (added > 0) this.prom?.recordCampaignLeadsAdded(added);
    const metrics = await this.computeMetrics(actor.cid, id);
    return {
      campaignId: id,
      added,
      skipped,
      leadCount: metrics.totalLeads,
      metrics,
    };
  }

  async removeLeads(
    actor: Actor,
    id: string,
    dto: RemoveCampaignLeadsDto,
    meta?: ReqMeta,
  ) {
    const campaign = await this.findCampaign(actor.cid, id);
    this.assertMembershipMutable(campaign.status);

    const uniqueIds = [...new Set(dto.leadIds)];
    let removed = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const leadId of uniqueIds) {
        const row = await tx.outboundCampaignLead.findFirst({
          where: {
            companyId: actor.cid,
            campaignId: id,
            leadId,
            deletedAt: null,
          },
        });
        if (!row) continue;
        await tx.outboundCampaignLead.update({
          where: { id: row.id },
          data: { deletedAt: new Date() },
        });
        const lead = await tx.lead.findFirst({
          where: { id: leadId, companyId: actor.cid },
          select: { metadata: true },
        });
        if (lead) {
          await this.clearLeadCampaignMetadata(tx, leadId, lead.metadata, id);
        }
        removed += 1;
      }
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: CAMPAIGN_LEADS_REMOVED,
        targetType: 'OUTBOUND_CAMPAIGN',
        targetId: id,
        before: null,
        after: { removed, pipeline: OUTBOUND_CAMPAIGN_PIPELINE },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
    });

    const metrics = await this.computeMetrics(actor.cid, id);
    return {
      campaignId: id,
      removed,
      leadCount: metrics.totalLeads,
      metrics,
    };
  }

  /** Attach all leads from a completed import batch (V1.2). */
  async attachImportBatch(
    actor: Actor,
    id: string,
    dto: AttachImportBatchDto,
    meta?: ReqMeta,
  ) {
    await this.findCampaign(actor.cid, id);
    const batch = await this.prisma.leadImportBatch.findFirst({
      where: {
        id: dto.importBatchId,
        companyId: actor.cid,
        deletedAt: null,
      },
      select: { id: true, status: true },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status !== 'COMPLETED') {
      throw new ConflictException('Import batch must be COMPLETED');
    }

    const leads = await this.prisma.lead.findMany({
      where: {
        companyId: actor.cid,
        deletedAt: null,
        metadata: {
          path: ['importBatchId'],
          equals: dto.importBatchId,
        },
      },
      select: { id: true },
      take: CAMPAIGN_ADD_LEADS_MAX,
    });

    if (leads.length === 0) {
      return {
        campaignId: id,
        added: 0,
        skipped: 0,
        leadCount: await this.countLeads(actor.cid, id),
        importBatchId: dto.importBatchId,
      };
    }

    return {
      ...(await this.addLeads(
        actor,
        id,
        { leadIds: leads.map((l) => l.id) },
        meta,
      )),
      importBatchId: dto.importBatchId,
    };
  }

  async listLeads(
    actor: Actor,
    id: string,
    query: { page?: number; pageSize?: number },
  ) {
    await this.findCampaign(actor.cid, id);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where: Prisma.OutboundCampaignLeadWhereInput = {
      companyId: actor.cid,
      campaignId: id,
      deletedAt: null,
    };
    const [total, rows] = await Promise.all([
      this.prisma.outboundCampaignLead.count({ where }),
      this.prisma.outboundCampaignLead.findMany({
        where,
        orderBy: { addedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          lead: {
            select: {
              id: true,
              name: true,
              phone: true,
              status: true,
              score: true,
              lastOutboundAt: true,
              lastInboundAt: true,
            },
          },
        },
      }),
    ]);

    return {
      items: rows.map((r) => ({
        membershipId: r.id,
        leadId: r.leadId,
        addedAt: r.addedAt.toISOString(),
        name: r.lead.name,
        phone: r.lead.phone,
        status: r.lead.status,
        score: r.lead.score,
        lastOutboundAt: r.lead.lastOutboundAt?.toISOString() ?? null,
        lastInboundAt: r.lead.lastInboundAt?.toISOString() ?? null,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getDashboard(actor: Actor) {
    const campaigns = await this.prisma.outboundCampaign.findMany({
      where: { companyId: actor.cid, deletedAt: null },
      select: { id: true, status: true },
    });
    const active = campaigns.filter(
      (c) =>
        c.status === CAMPAIGN_STATUSES.RUNNING ||
        c.status === CAMPAIGN_STATUSES.PAUSED,
    ).length;
    const completed = campaigns.filter(
      (c) => c.status === CAMPAIGN_STATUSES.COMPLETED,
    ).length;

    let totalLeads = 0;
    let eligible = 0;
    let sent = 0;
    let responded = 0;
    let hot = 0;
    let converted = 0;

    for (const c of campaigns) {
      const m = await this.computeMetrics(actor.cid, c.id);
      totalLeads += m.totalLeads;
      eligible += m.eligible;
      sent += m.firstTouchSent;
      responded += m.responded;
      hot += m.hot;
      converted += m.converted;
    }

    const replyRate = sent > 0 ? responded / sent : 0;
    this.prom?.setCampaignReplyRate(replyRate);
    this.prom?.setCampaignsTotal(campaigns.length);

    return {
      companyId: actor.cid,
      generatedAt: new Date().toISOString(),
      metrics: {
        campaignsTotal: campaigns.length,
        active,
        completed,
        totalLeads,
        eligible,
        firstTouchSent: sent,
        responded,
        hot,
        converted,
        replyRate: Math.round(replyRate * 1000) / 1000,
        hotRate: responded > 0 ? Math.round((hot / responded) * 1000) / 1000 : 0,
        convertRate: sent > 0 ? Math.round((converted / sent) * 1000) / 1000 : 0,
      },
    };
  }

  /** Generate First Touch D0 for eligible leads in a RUNNING campaign. */
  async generateFirstTouch(
    actor: Actor,
    id: string,
    dto: GenerateCampaignFirstTouchDto,
    meta?: ReqMeta,
  ) {
    const campaign = await this.findCampaign(actor.cid, id);
    if (campaign.status !== CAMPAIGN_STATUSES.RUNNING) {
      throw new ConflictException(
        'Campaign must be RUNNING to generate First Touch',
      );
    }

    const memberships = await this.prisma.outboundCampaignLead.findMany({
      where: { companyId: actor.cid, campaignId: id, deletedAt: null },
      select: { leadId: true },
      take: 500,
    });
    const leadIds = memberships.map((m) => m.leadId);
    if (leadIds.length === 0) {
      return {
        campaignId: id,
        created: 0,
        skipped: 0,
        items: [],
        skippedReasons: { noLeads: true },
      };
    }

    const result = await this.firstTouch.generate(
      actor,
      { leadIds, limit: dto.limit },
      meta,
    );
    return { campaignId: id, ...result };
  }

  async computeMetrics(companyId: string, campaignId: string) {
    const memberships = await this.prisma.outboundCampaignLead.findMany({
      where: { companyId, campaignId, deletedAt: null },
      select: { leadId: true },
    });
    const leadIds = memberships.map((m) => m.leadId);
    const totalLeads = leadIds.length;
    if (totalLeads === 0) {
      return {
        totalLeads: 0,
        eligible: 0,
        firstTouchSent: 0,
        responded: 0,
        hot: 0,
        converted: 0,
        replyRate: 0,
        hotRate: 0,
        convertRate: 0,
      };
    }

    const leads = await this.prisma.lead.findMany({
      where: { companyId, id: { in: leadIds }, deletedAt: null },
      select: {
        id: true,
        status: true,
        score: true,
        lastOutboundAt: true,
        lastInboundAt: true,
      },
    });

    const ftExecuted = await this.prisma.followUp.findMany({
      where: {
        companyId,
        leadId: { in: leadIds },
        type: OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE,
        status: FollowUpStatus.EXECUTED,
        deletedAt: null,
      },
      select: { leadId: true },
      distinct: ['leadId'],
    });
    const sentSet = new Set(ftExecuted.map((f) => f.leadId));

    let eligible = 0;
    let responded = 0;
    let hot = 0;
    let converted = 0;

    for (const lead of leads) {
      if (lead.status === LeadStatus.NEW && lead.lastOutboundAt == null) {
        eligible += 1;
      }
      if (
        sentSet.has(lead.id) &&
        lead.lastInboundAt &&
        lead.lastOutboundAt &&
        lead.lastInboundAt > lead.lastOutboundAt
      ) {
        responded += 1;
      }
      if (lead.score >= CAMPAIGN_HOT_SCORE_THRESHOLD) {
        hot += 1;
      }
      if (lead.status === LeadStatus.CONVERTED) {
        converted += 1;
      }
    }

    const firstTouchSent = sentSet.size;
    const replyRate = firstTouchSent > 0 ? responded / firstTouchSent : 0;

    return {
      totalLeads,
      eligible,
      firstTouchSent,
      responded,
      hot,
      converted,
      replyRate: Math.round(replyRate * 1000) / 1000,
      hotRate:
        responded > 0 ? Math.round((hot / responded) * 1000) / 1000 : 0,
      convertRate:
        firstTouchSent > 0
          ? Math.round((converted / firstTouchSent) * 1000) / 1000
          : 0,
    };
  }

  private assertMembershipMutable(status: string) {
    if (
      status === CAMPAIGN_STATUSES.COMPLETED ||
      status === CAMPAIGN_STATUSES.ARCHIVED
    ) {
      throw new ConflictException(
        `Cannot change leads when campaign is ${status}`,
      );
    }
  }

  private async findCampaign(companyId: string, id: string) {
    const row = await this.prisma.outboundCampaign.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Campaign not found');
    return row;
  }

  private async countLeads(companyId: string, campaignId: string) {
    return this.prisma.outboundCampaignLead.count({
      where: { companyId, campaignId, deletedAt: null },
    });
  }

  private async stampLeadCampaignMetadata(
    tx: Prisma.TransactionClient,
    leadId: string,
    existing: Prisma.JsonValue | null,
    campaignId: string,
  ) {
    const meta =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    meta.outboundCampaignId = campaignId;
    await tx.lead.update({
      where: { id: leadId },
      data: { metadata: meta as Prisma.InputJsonValue },
    });
  }

  private async clearLeadCampaignMetadata(
    tx: Prisma.TransactionClient,
    leadId: string,
    existing: Prisma.JsonValue | null,
    campaignId: string,
  ) {
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      return;
    }
    const meta = { ...(existing as Record<string, unknown>) };
    if (meta.outboundCampaignId !== campaignId) return;
    delete meta.outboundCampaignId;
    await tx.lead.update({
      where: { id: leadId },
      data: { metadata: meta as Prisma.InputJsonValue },
    });
  }

  serialize(
    row: {
      id: string;
      companyId: string;
      name: string;
      description: string | null;
      objective: string;
      status: string;
      startedAt: Date | null;
      pausedAt: Date | null;
      completedAt: Date | null;
      archivedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      createdByUserId?: string | null;
    },
    leadCount: number,
  ) {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      description: row.description,
      objective: row.objective,
      status: row.status,
      leadCount,
      startedAt: row.startedAt?.toISOString() ?? null,
      pausedAt: row.pausedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdByUserId: row.createdByUserId ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
