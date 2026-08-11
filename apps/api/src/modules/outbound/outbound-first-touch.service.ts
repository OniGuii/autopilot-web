import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  Channel,
  ConversationStatus,
  FollowUpStatus,
  KnowledgeBaseKind,
  LeadStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { OutboundSuppressService } from './outbound-suppress.service';
import { GenerateFirstTouchDto } from './dto/generate-first-touch.dto';
import { UpdateFirstTouchSettingsDto } from './dto/update-first-touch-settings.dto';
import {
  FIRST_TOUCH_APPROVED,
  FIRST_TOUCH_BLOCKING_STATUSES,
  FIRST_TOUCH_CREATED,
  FIRST_TOUCH_DEFAULT_MAX_BATCH,
  FIRST_TOUCH_FAILED,
  FIRST_TOUCH_MODES,
  FIRST_TOUCH_PLAYBOOKS,
  FIRST_TOUCH_REJECTED,
  FIRST_TOUCH_SENT,
  FIRST_TOUCH_SETTINGS_UPDATED,
  OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE,
  OUTBOUND_FIRST_TOUCH_MESSAGE_SOURCE,
  OUTBOUND_FIRST_TOUCH_PIPELINE,
} from './outbound-first-touch.constants';
import { buildFirstTouchBody } from './utils/first-touch-copy';

type Actor = { cid: string; sub: string };
type ReqMeta = { ip?: string; userAgent?: string };

type LeadMeta = {
  city?: unknown;
  product?: unknown;
  value?: unknown;
  notes?: unknown;
  importBatchId?: unknown;
  outboundCampaignId?: unknown;
};

@Injectable()
export class OutboundFirstTouchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly suppress: OutboundSuppressService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  async getOrCreateSettings(actor: Actor) {
    const existing = await this.prisma.companyFirstTouchSettings.findFirst({
      where: { companyId: actor.cid, deletedAt: null },
    });
    if (existing) return this.serializeSettings(existing);

    const created = await this.prisma.companyFirstTouchSettings.create({
      data: {
        companyId: actor.cid,
        mode: FIRST_TOUCH_MODES.OFF,
        verticalPlaybook: FIRST_TOUCH_PLAYBOOKS.GENERIC,
        maxBatchSize: FIRST_TOUCH_DEFAULT_MAX_BATCH,
        requireImportBatch: false,
        enableKbGrounding: true,
        enableMemorySeed: true,
      },
    });
    return this.serializeSettings(created);
  }

  async updateSettings(
    actor: Actor,
    dto: UpdateFirstTouchSettingsDto,
    meta?: ReqMeta,
  ) {
    const before = await this.getOrCreateSettings(actor);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.companyFirstTouchSettings.update({
        where: { companyId: actor.cid },
        data: {
          ...(dto.mode !== undefined ? { mode: dto.mode } : {}),
          ...(dto.verticalPlaybook !== undefined
            ? { verticalPlaybook: dto.verticalPlaybook }
            : {}),
          ...(dto.maxBatchSize !== undefined
            ? { maxBatchSize: dto.maxBatchSize }
            : {}),
          ...(dto.requireImportBatch !== undefined
            ? { requireImportBatch: dto.requireImportBatch }
            : {}),
          ...(dto.enableKbGrounding !== undefined
            ? { enableKbGrounding: dto.enableKbGrounding }
            : {}),
          ...(dto.enableMemorySeed !== undefined
            ? { enableMemorySeed: dto.enableMemorySeed }
            : {}),
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: FIRST_TOUCH_SETTINGS_UPDATED,
        targetType: 'FIRST_TOUCH_SETTINGS',
        targetId: updated.id,
        before,
        after: this.serializeSettings(updated),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return updated;
    });
    return this.serializeSettings(row);
  }

  async getDashboard(actor: Actor, windowDays = 7) {
    const settings = await this.getOrCreateSettings(actor);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const eligible = await this.countEligible(actor.cid, settings);

    const fus = await this.prisma.followUp.findMany({
      where: {
        companyId: actor.cid,
        type: OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE,
        deletedAt: null,
        createdAt: { gte: since },
      },
      select: {
        id: true,
        status: true,
        leadId: true,
        executedAt: true,
        createdAt: true,
      },
    });

    const generated = fus.length;
    const approved = fus.filter(
      (f) =>
        f.status === FollowUpStatus.SCHEDULED ||
        f.status === FollowUpStatus.EXECUTING ||
        f.status === FollowUpStatus.EXECUTED ||
        f.status === FollowUpStatus.FAILED,
    ).length;
    const sent = fus.filter((f) => f.status === FollowUpStatus.EXECUTED).length;
    const failed = fus.filter((f) => f.status === FollowUpStatus.FAILED).length;

    const sentLeadIds = [
      ...new Set(
        fus
          .filter((f) => f.status === FollowUpStatus.EXECUTED)
          .map((f) => f.leadId),
      ),
    ];

    let delivered = sent;
    let responded = 0;
    if (sentLeadIds.length > 0) {
      const leads = await this.prisma.lead.findMany({
        where: { companyId: actor.cid, id: { in: sentLeadIds } },
        select: {
          id: true,
          lastInboundAt: true,
          lastOutboundAt: true,
        },
      });
      delivered = leads.filter((l) => l.lastOutboundAt != null).length;
      responded = leads.filter(
        (l) =>
          l.lastInboundAt != null &&
          l.lastOutboundAt != null &&
          l.lastInboundAt > l.lastOutboundAt,
      ).length;
    }

    const replyRate = sent > 0 ? responded / sent : 0;
    this.prom?.setFirstTouchReplyRate(replyRate);

    return {
      companyId: actor.cid,
      generatedAt: new Date().toISOString(),
      windowDays,
      mode: settings.mode,
      verticalPlaybook: settings.verticalPlaybook,
      metrics: {
        eligible,
        generated,
        approved,
        sent,
        delivered,
        responded,
        failed,
        replyRate: Math.round(replyRate * 1000) / 1000,
      },
    };
  }

  async list(
    actor: Actor,
    query: { status?: string; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const settings = await this.getOrCreateSettings(actor);

    const where: Prisma.FollowUpWhereInput = {
      companyId: actor.cid,
      type: OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE,
      deletedAt: null,
      ...(query.status
        ? { status: query.status as FollowUpStatus }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.followUp.count({ where }),
      this.prisma.followUp.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          lead: {
            select: {
              id: true,
              name: true,
              phone: true,
              status: true,
            },
          },
        },
      }),
    ]);

    return {
      items: items.map((fu) => ({
        id: fu.id,
        leadId: fu.leadId,
        leadName: fu.lead.name,
        leadPhone: fu.lead.phone,
        leadStatus: fu.lead.status,
        conversationId: fu.conversationId,
        status: fu.status,
        mode: settings.mode,
        body: fu.suggestedBody,
        scheduledAt: fu.scheduledAt?.toISOString() ?? null,
        executedAt: fu.executedAt?.toISOString() ?? null,
        createdAt: fu.createdAt.toISOString(),
        updatedAt: fu.updatedAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async generate(actor: Actor, dto: GenerateFirstTouchDto, meta?: ReqMeta) {
    const settings = await this.getOrCreateSettings(actor);
    if (settings.mode === FIRST_TOUCH_MODES.OFF) {
      throw new ConflictException(
        'First Touch mode is OFF — enable HUMAN_APPROVE or AUTO_SEND',
      );
    }

    if (settings.requireImportBatch && !dto.importBatchId && !dto.leadIds?.length) {
      throw new BadRequestException(
        'importBatchId or leadIds required when requireImportBatch=true',
      );
    }

    const company = await this.prisma.company.findFirst({
      where: { id: actor.cid, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const limit = Math.min(
      dto.limit ?? settings.maxBatchSize,
      settings.maxBatchSize,
      100,
    );

    const leads = await this.findEligibleLeads(actor.cid, settings, dto, limit);
    if (leads.length === 0) {
      return {
        mode: settings.mode,
        created: 0,
        skipped: 0,
        items: [] as unknown[],
        skippedReasons: { noneEligible: true },
      };
    }

    const created: unknown[] = [];
    const skippedReasons: Record<string, number> = {};
    let skipped = 0;

    for (const lead of leads) {
      try {
        const item = await this.generateForLead(
          actor,
          lead,
          company.name,
          settings,
          meta,
        );
        created.push(item);
      } catch (err) {
        skipped += 1;
        const reason =
          err instanceof Error ? err.message.slice(0, 80) : 'UNKNOWN';
        skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
      }
    }

    return {
      mode: settings.mode,
      created: created.length,
      skipped,
      items: created,
      skippedReasons,
    };
  }

  async approve(actor: Actor, followUpId: string, meta?: ReqMeta) {
    const settings = await this.getOrCreateSettings(actor);
    if (settings.mode === FIRST_TOUCH_MODES.OFF) {
      throw new ConflictException('First Touch mode is OFF');
    }

    const existing = await this.findFirstTouchFollowUp(actor.cid, followUpId);
    if (existing.status !== FollowUpStatus.SUGGESTED) {
      throw new ConflictException('Only SUGGESTED first-touch can be approved');
    }

    const now = new Date();
    const followUp = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.followUp.update({
        where: { id: existing.id },
        data: {
          status: FollowUpStatus.SCHEDULED,
          approvedBy: actor.sub,
          approvedAt: now,
          scheduledAt: existing.scheduledAt ?? now,
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: FIRST_TOUCH_APPROVED,
        targetType: 'FOLLOWUP',
        targetId: updated.id,
        before: { status: existing.status },
        after: {
          status: updated.status,
          scheduledAt: updated.scheduledAt?.toISOString() ?? null,
          pipeline: OUTBOUND_FIRST_TOUCH_PIPELINE,
        },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return updated;
    });

    return this.toFollowUpItem(followUp, settings.mode);
  }

  async reject(actor: Actor, followUpId: string, meta?: ReqMeta) {
    const existing = await this.findFirstTouchFollowUp(actor.cid, followUpId);
    if (
      existing.status !== FollowUpStatus.SUGGESTED &&
      existing.status !== FollowUpStatus.SCHEDULED
    ) {
      throw new ConflictException(
        'Only SUGGESTED or SCHEDULED first-touch can be rejected',
      );
    }

    const settings = await this.getOrCreateSettings(actor);
    const followUp = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.followUp.update({
        where: { id: existing.id },
        data: {
          status: FollowUpStatus.REJECTED,
          cancelReason: 'FIRST_TOUCH_REJECTED',
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: FIRST_TOUCH_REJECTED,
        targetType: 'FOLLOWUP',
        targetId: updated.id,
        before: { status: existing.status },
        after: { status: updated.status },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return updated;
    });

    return this.toFollowUpItem(followUp, settings.mode);
  }

  /** Called from FollowUpService after successful D0 send. */
  async afterSent(input: {
    companyId: string;
    followUpId: string;
    messageId: string;
    actorUserId: string | null;
    correlationId?: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.audit.write(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: FIRST_TOUCH_SENT,
        targetType: 'FOLLOWUP',
        targetId: input.followUpId,
        before: null,
        after: {
          messageId: input.messageId,
          source: OUTBOUND_FIRST_TOUCH_MESSAGE_SOURCE,
          correlationId: input.correlationId ?? null,
          pipeline: OUTBOUND_FIRST_TOUCH_PIPELINE,
        },
      });
    });
    this.prom?.recordFirstTouchSent();
  }

  /** Called from FollowUpService after failed D0 send. */
  async afterFailed(input: {
    companyId: string;
    followUpId: string;
    errorMessage?: string;
    actorUserId?: string | null;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.audit.write(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId ?? null,
        action: FIRST_TOUCH_FAILED,
        targetType: 'FOLLOWUP',
        targetId: input.followUpId,
        before: null,
        after: {
          errorMessage: input.errorMessage?.slice(0, 500) ?? null,
          pipeline: OUTBOUND_FIRST_TOUCH_PIPELINE,
        },
      });
    });
    this.prom?.recordFirstTouchFailed();
  }

  private async generateForLead(
    actor: Actor,
    lead: {
      id: string;
      name: string | null;
      phone: string;
      status: LeadStatus;
      metadata: Prisma.JsonValue | null;
      lastOutboundAt: Date | null;
    },
    companyName: string,
    settings: ReturnType<OutboundFirstTouchService['serializeSettings']>,
    meta?: ReqMeta,
  ) {
    if (await this.suppress.isSuppressed(actor.cid, lead.phone)) {
      throw new Error('SUPPRESSED');
    }

    const blocking = await this.prisma.followUp.findFirst({
      where: {
        companyId: actor.cid,
        leadId: lead.id,
        type: OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE,
        status: { in: [...FIRST_TOUCH_BLOCKING_STATUSES] as FollowUpStatus[] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (blocking) throw new Error('ALREADY_HAS_FIRST_TOUCH');

    const metaObj = (lead.metadata ?? {}) as LeadMeta;
    const product = strOrNull(metaObj.product);
    const city = strOrNull(metaObj.city);
    const value = strOrNull(metaObj.value);
    const notes = strOrNull(metaObj.notes);

    let kbSnippet: string | null = null;
    if (settings.enableKbGrounding) {
      kbSnippet = await this.resolveKbSnippet(
        actor.cid,
        [product, city, notes, 'produto'].filter(Boolean).join(' '),
      );
    }

    const body = buildFirstTouchBody({
      companyName,
      leadName: lead.name,
      product,
      city,
      value,
      notes,
      kbSnippet,
      playbook: settings.verticalPlaybook,
    });

    const status =
      settings.mode === FIRST_TOUCH_MODES.AUTO_SEND
        ? FollowUpStatus.SCHEDULED
        : FollowUpStatus.SUGGESTED;
    const scheduledAt =
      status === FollowUpStatus.SCHEDULED ? new Date() : null;

    const followUp = await this.prisma.$transaction(async (tx) => {
      const conversation = await this.resolveOrCreateConversation(
        tx,
        actor.cid,
        lead,
        settings.enableMemorySeed,
        { city, product, value },
      );

      const created = await tx.followUp.create({
        data: {
          companyId: actor.cid,
          leadId: lead.id,
          conversationId: conversation.id,
          assignedUserId: actor.sub,
          approvedBy:
            status === FollowUpStatus.SCHEDULED ? actor.sub : null,
          approvedAt: status === FollowUpStatus.SCHEDULED ? new Date() : null,
          channel: Channel.WHATSAPP,
          status,
          type: OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE,
          scheduledAt,
          suggestedBody: body,
          metadata: {
            source: OUTBOUND_FIRST_TOUCH_MESSAGE_SOURCE,
            pipeline: OUTBOUND_FIRST_TOUCH_PIPELINE,
            mode: settings.mode,
            playbook: settings.verticalPlaybook,
            importBatchId: strOrNull(metaObj.importBatchId),
            outboundCampaignId: strOrNull(metaObj.outboundCampaignId),
          },
        },
      });

      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: FIRST_TOUCH_CREATED,
        targetType: 'FOLLOWUP',
        targetId: created.id,
        before: null,
        after: {
          leadId: lead.id,
          conversationId: conversation.id,
          status: created.status,
          mode: settings.mode,
          bodyPreview: body.slice(0, 200),
          pipeline: OUTBOUND_FIRST_TOUCH_PIPELINE,
        },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return created;
    });

    this.prom?.recordFirstTouchCreated();
    return this.toFollowUpItem(followUp, settings.mode, {
      name: lead.name,
      phone: lead.phone,
      status: lead.status,
    });
  }

  private async resolveOrCreateConversation(
    tx: Prisma.TransactionClient,
    companyId: string,
    lead: { id: string },
    enableMemorySeed: boolean,
    slots: { city: string | null; product: string | null; value: string | null },
  ) {
    const open = await tx.conversation.findFirst({
      where: {
        companyId,
        leadId: lead.id,
        channel: Channel.WHATSAPP,
        deletedAt: null,
        status: {
          in: [ConversationStatus.OPEN, ConversationStatus.IDLE],
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (open) {
      if (enableMemorySeed) {
        await this.seedSalesMemory(tx, open.id, open.metadata, slots);
      }
      return open;
    }

    const salesMemory = enableMemorySeed
      ? {
          salesStage: 'DISCOVERY',
          city: slots.city,
          productInterest: slots.product ? [slots.product] : null,
          budget: slots.value,
          source: OUTBOUND_FIRST_TOUCH_MESSAGE_SOURCE,
          version: 1,
          updatedAt: new Date().toISOString(),
        }
      : undefined;

    return tx.conversation.create({
      data: {
        companyId,
        leadId: lead.id,
        channel: Channel.WHATSAPP,
        status: ConversationStatus.OPEN,
        metadata: salesMemory
          ? ({ salesMemory } as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  private async seedSalesMemory(
    tx: Prisma.TransactionClient,
    conversationId: string,
    existingMeta: Prisma.JsonValue | null,
    slots: { city: string | null; product: string | null; value: string | null },
  ) {
    const meta =
      existingMeta && typeof existingMeta === 'object' && !Array.isArray(existingMeta)
        ? { ...(existingMeta as Record<string, unknown>) }
        : {};
    const prev =
      meta.salesMemory && typeof meta.salesMemory === 'object'
        ? (meta.salesMemory as Record<string, unknown>)
        : {};

    if (prev.salesStage) return;

    meta.salesMemory = {
      ...prev,
      salesStage: 'DISCOVERY',
      city: prev.city ?? slots.city,
      productInterest:
        prev.productInterest ??
        (slots.product ? [slots.product] : null),
      budget: prev.budget ?? slots.value,
      source: OUTBOUND_FIRST_TOUCH_MESSAGE_SOURCE,
      version: typeof prev.version === 'number' ? prev.version + 1 : 1,
      updatedAt: new Date().toISOString(),
    };

    await tx.conversation.update({
      where: { id: conversationId },
      data: { metadata: meta as Prisma.InputJsonValue },
    });
  }

  private async resolveKbSnippet(
    companyId: string,
    message: string,
  ): Promise<string | null> {
    const entries = await this.prisma.knowledgeBaseEntry.findMany({
      where: {
        companyId,
        deletedAt: null,
        active: true,
        kind: {
          in: [
            KnowledgeBaseKind.PRODUCT,
            KnowledgeBaseKind.PRICE,
            KnowledgeBaseKind.FAQ,
          ],
        },
      },
      take: 40,
      select: { title: true, body: true, tags: true, kind: true },
    });
    if (entries.length === 0) return null;

    const tokens = message
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3);
    if (tokens.length === 0) {
      return entries[0].body.slice(0, 120);
    }

    let best: { body: string; score: number } | null = null;
    for (const e of entries) {
      const hay = `${e.title} ${e.body} ${e.tags.join(' ')}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += 1;
      }
      if (!best || score > best.score) {
        best = { body: e.body, score };
      }
    }
    if (!best || best.score <= 0) return null;
    return best.body.slice(0, 120);
  }

  private async findEligibleLeads(
    companyId: string,
    settings: ReturnType<OutboundFirstTouchService['serializeSettings']>,
    dto: GenerateFirstTouchDto,
    limit: number,
  ) {
    const where: Prisma.LeadWhereInput = {
      companyId,
      deletedAt: null,
      status: LeadStatus.NEW,
      lastOutboundAt: null,
      ...(dto.leadIds?.length ? { id: { in: dto.leadIds } } : {}),
    };

    // Prisma JSON filter for importBatchId when provided
    if (dto.importBatchId) {
      where.metadata = {
        path: ['importBatchId'],
        equals: dto.importBatchId,
      };
    } else if (settings.requireImportBatch && !dto.leadIds?.length) {
      return [];
    }

    // Fetch extra then filter blocking FU / suppress in loop (cap)
    const candidates = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit * 3, 300),
      select: {
        id: true,
        name: true,
        phone: true,
        status: true,
        metadata: true,
        lastOutboundAt: true,
      },
    });

    const result: typeof candidates = [];
    for (const lead of candidates) {
      if (result.length >= limit) break;
      const hasFu = await this.prisma.followUp.findFirst({
        where: {
          companyId,
          leadId: lead.id,
          type: OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE,
          status: {
            in: [...FIRST_TOUCH_BLOCKING_STATUSES] as FollowUpStatus[],
          },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (hasFu) continue;
      if (await this.suppress.isSuppressed(companyId, lead.phone)) continue;
      result.push(lead);
    }
    return result;
  }

  private async countEligible(
    companyId: string,
    settings: ReturnType<OutboundFirstTouchService['serializeSettings']>,
  ) {
    const where: Prisma.LeadWhereInput = {
      companyId,
      deletedAt: null,
      status: LeadStatus.NEW,
      lastOutboundAt: null,
    };
    if (settings.requireImportBatch) {
      // Approximate: NEW without outbound; exact import filter is heavy — count NEW cold
    }
    const leads = await this.prisma.lead.findMany({
      where,
      select: { id: true, phone: true },
      take: 500,
    });
    let n = 0;
    for (const lead of leads) {
      const hasFu = await this.prisma.followUp.findFirst({
        where: {
          companyId,
          leadId: lead.id,
          type: OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE,
          status: {
            in: [...FIRST_TOUCH_BLOCKING_STATUSES] as FollowUpStatus[],
          },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (hasFu) continue;
      if (await this.suppress.isSuppressed(companyId, lead.phone)) continue;
      n += 1;
    }
    return n;
  }

  private async findFirstTouchFollowUp(companyId: string, id: string) {
    const fu = await this.prisma.followUp.findFirst({
      where: {
        id,
        companyId,
        type: OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE,
        deletedAt: null,
      },
    });
    if (!fu) throw new NotFoundException('First Touch follow-up not found');
    return fu;
  }

  private toFollowUpItem(
    fu: {
      id: string;
      leadId: string;
      conversationId: string | null;
      status: FollowUpStatus;
      suggestedBody: string | null;
      scheduledAt: Date | null;
      executedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    mode: string,
    lead?: { name: string | null; phone: string; status: LeadStatus },
  ) {
    return {
      id: fu.id,
      leadId: fu.leadId,
      leadName: lead?.name ?? null,
      leadPhone: lead?.phone ?? null,
      leadStatus: lead?.status ?? null,
      conversationId: fu.conversationId,
      status: fu.status,
      mode,
      body: fu.suggestedBody,
      scheduledAt: fu.scheduledAt?.toISOString() ?? null,
      executedAt: fu.executedAt?.toISOString() ?? null,
      createdAt: fu.createdAt.toISOString(),
      updatedAt: fu.updatedAt.toISOString(),
    };
  }

  serializeSettings(row: {
    id: string;
    companyId: string;
    mode: string;
    verticalPlaybook: string;
    maxBatchSize: number;
    requireImportBatch: boolean;
    enableKbGrounding: boolean;
    enableMemorySeed: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      companyId: row.companyId,
      mode: row.mode,
      verticalPlaybook: row.verticalPlaybook,
      maxBatchSize: row.maxBatchSize,
      requireImportBatch: row.requireImportBatch,
      enableKbGrounding: row.enableKbGrounding,
      enableMemorySeed: row.enableMemorySeed,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}
