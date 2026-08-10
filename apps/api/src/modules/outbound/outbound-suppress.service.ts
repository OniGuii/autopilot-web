import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { normalizePhone } from '../leads/utils/normalize-phone';
import {
  OUTBOUND_OPT_OUT,
  OUTBOUND_SUPPRESS_ADDED,
  OUTBOUND_SUPPRESS_REMOVED,
  OUTBOUND_SUPPRESS_SOURCES,
  type OutboundSuppressSource,
} from './outbound.constants';
import { CreateOutboundSuppressDto } from './dto/create-outbound-suppress.dto';
import { ListOutboundSuppressQueryDto } from './dto/list-outbound-suppress.query.dto';
import { OutboundProtectionSettingsService } from './outbound-protection-settings.service';

type Actor = { cid: string; sub: string };
type ReqMeta = { ip?: string; userAgent?: string };

@Injectable()
export class OutboundSuppressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: OutboundProtectionSettingsService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  async list(actor: Actor, query: ListOutboundSuppressQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const activeOnly = query.activeOnly !== false;

    const where = {
      companyId: actor.cid,
      deletedAt: null,
      ...(activeOnly ? { active: true } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.outboundSuppressEntry.count({ where }),
      this.prisma.outboundSuppressEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((r) => this.serialize(r)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async addManual(
    actor: Actor,
    dto: CreateOutboundSuppressDto,
    meta?: ReqMeta,
  ) {
    return this.upsert({
      companyId: actor.cid,
      phone: dto.phone,
      leadId: dto.leadId,
      reason: dto.reason ?? 'Manual suppress',
      source: OUTBOUND_SUPPRESS_SOURCES.MANUAL,
      actorUserId: actor.sub,
      auditAction: OUTBOUND_SUPPRESS_ADDED,
      meta,
    });
  }

  async remove(actor: Actor, id: string, meta?: ReqMeta) {
    const existing = await this.prisma.outboundSuppressEntry.findFirst({
      where: { id, companyId: actor.cid, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Suppress entry not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.outboundSuppressEntry.update({
        where: { id },
        data: { active: false },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: OUTBOUND_SUPPRESS_REMOVED,
        targetType: 'OUTBOUND_SUPPRESS',
        targetId: row.id,
        before: this.serialize(existing),
        after: this.serialize(row),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return row;
    });
    this.prom?.recordOutboundSuppressRemoved();
    return this.serialize(updated);
  }

  async isSuppressed(companyId: string, phone: string): Promise<boolean> {
    const normalized = normalizePhone(phone);
    if (!normalized) return false;
    const row = await this.prisma.outboundSuppressEntry.findFirst({
      where: {
        companyId,
        phone: normalized,
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  /**
   * Keyword opt-out from inbound body. Adds suppress + audit OUTBOUND_OPT_OUT.
   * Returns true when a new/reactivated suppress was applied.
   */
  async maybeOptOutFromInbound(input: {
    companyId: string;
    leadId: string;
    phone: string;
    body: string;
  }): Promise<boolean> {
    const policy = await this.settings.getOrCreate({
      cid: input.companyId,
      sub: 'system',
    });
    const keywords = policy.suppressOnKeywords.map((k) => k.toLowerCase());
    if (keywords.length === 0) return false;

    const normalizedBody = input.body.trim().toLowerCase();
    if (!normalizedBody) return false;

    const matched = keywords.find((kw) => {
      if (!kw) return false;
      // Whole-message or word-boundary-ish match for short keywords.
      if (normalizedBody === kw) return true;
      const re = new RegExp(
        `(^|\\s|[.,!?])${escapeRegExp(kw)}(\\s|[.,!?]|$)`,
        'i',
      );
      return re.test(normalizedBody);
    });
    if (!matched) return false;

    await this.upsert({
      companyId: input.companyId,
      phone: input.phone,
      leadId: input.leadId,
      reason: `Opt-out keyword: ${matched}`,
      source: OUTBOUND_SUPPRESS_SOURCES.KEYWORD,
      actorUserId: null,
      auditAction: OUTBOUND_OPT_OUT,
    });
    this.prom?.recordOutboundOptOut();
    return true;
  }

  async maybeSuppressOnLost(input: {
    companyId: string;
    leadId: string;
    phone: string;
    status: LeadStatus;
  }): Promise<void> {
    if (input.status !== LeadStatus.LOST) return;
    const policy = await this.settings.getOrCreate({
      cid: input.companyId,
      sub: 'system',
    });
    if (!policy.autoSuppressOnLost) return;

    await this.upsert({
      companyId: input.companyId,
      phone: input.phone,
      leadId: input.leadId,
      reason: 'Lead marked LOST',
      source: OUTBOUND_SUPPRESS_SOURCES.LOST,
      actorUserId: null,
      auditAction: OUTBOUND_SUPPRESS_ADDED,
    });
  }

  private async upsert(input: {
    companyId: string;
    phone: string;
    leadId?: string | null;
    reason?: string | null;
    source: OutboundSuppressSource;
    actorUserId: string | null;
    auditAction: string;
    meta?: ReqMeta;
  }) {
    const phone = normalizePhone(input.phone);
    if (phone.length < 8) {
      throw new BadRequestException('phone is invalid');
    }

    let leadId = input.leadId ?? null;
    if (leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, companyId: input.companyId, deletedAt: null },
        select: { id: true, phone: true },
      });
      if (!lead) throw new BadRequestException('leadId not found');
    } else {
      const lead = await this.prisma.lead.findFirst({
        where: { companyId: input.companyId, phone, deletedAt: null },
        select: { id: true },
      });
      leadId = lead?.id ?? null;
    }

    const before = await this.prisma.outboundSuppressEntry.findFirst({
      where: { companyId: input.companyId, phone, deletedAt: null },
    });

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.outboundSuppressEntry.upsert({
        where: {
          companyId_phone: { companyId: input.companyId, phone },
        },
        create: {
          companyId: input.companyId,
          phone,
          leadId,
          reason: input.reason ?? null,
          source: input.source,
          active: true,
        },
        update: {
          active: true,
          leadId: leadId ?? undefined,
          reason: input.reason ?? undefined,
          source: input.source,
          deletedAt: null,
        },
      });
      await this.audit.write(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: input.auditAction,
        targetType: 'OUTBOUND_SUPPRESS',
        targetId: updated.id,
        before: before ? this.serialize(before) : null,
        after: this.serialize(updated),
        ip: input.meta?.ip,
        userAgent: input.meta?.userAgent,
      });
      return updated;
    });

    this.prom?.recordOutboundSuppressAdded();
    return this.serialize(row);
  }

  serialize(row: {
    id: string;
    companyId: string;
    phone: string;
    leadId: string | null;
    reason: string | null;
    source: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      companyId: row.companyId,
      phone: row.phone,
      leadId: row.leadId,
      reason: row.reason,
      source: row.source,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
