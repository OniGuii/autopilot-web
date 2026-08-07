import {
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { KnowledgeBaseKind, type Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import {
  AI_KB_CREATED,
  AI_KB_DELETED,
  AI_KB_PROMPT_BUDGET_CHARS,
  AI_KB_UPDATED,
} from './ai.constants';
import { CreateKnowledgeBaseEntryDto } from './dto/create-knowledge-base-entry.dto';
import { ListKnowledgeBaseQueryDto } from './dto/list-knowledge-base.query.dto';
import { UpdateKnowledgeBaseEntryDto } from './dto/update-knowledge-base-entry.dto';

type Actor = { cid: string; sub: string };
type ReqMeta = { ip?: string; userAgent?: string };

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly _prom?: PrometheusMetricsService,
  ) {}

  async list(actor: Actor, query: ListKnowledgeBaseQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Prisma.KnowledgeBaseEntryWhereInput = {
      companyId: actor.cid,
      deletedAt: null,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.active === undefined ? {} : { active: query.active }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.knowledgeBaseEntry.count({ where }),
      this.prisma.knowledgeBaseEntry.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: items.map((i) => this.serialize(i)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async get(actor: Actor, id: string) {
    const row = await this.prisma.knowledgeBaseEntry.findFirst({
      where: { id, companyId: actor.cid, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Knowledge base entry not found');
    return this.serialize(row);
  }

  async create(
    actor: Actor,
    dto: CreateKnowledgeBaseEntryDto,
    meta?: ReqMeta,
  ) {
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.knowledgeBaseEntry.create({
        data: {
          companyId: actor.cid,
          kind: dto.kind,
          title: dto.title.trim(),
          body: dto.body.trim(),
          tags: dto.tags ?? [],
          active: dto.active ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: AI_KB_CREATED,
        targetType: 'KNOWLEDGE_BASE',
        targetId: row.id,
        before: null,
        after: this.serialize(row),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return row;
    });
    return this.serialize(created);
  }

  async update(
    actor: Actor,
    id: string,
    dto: UpdateKnowledgeBaseEntryDto,
    meta?: ReqMeta,
  ) {
    const existing = await this.prisma.knowledgeBaseEntry.findFirst({
      where: { id, companyId: actor.cid, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Knowledge base entry not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.knowledgeBaseEntry.update({
        where: { id },
        data: {
          ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.body !== undefined ? { body: dto.body.trim() } : {}),
          ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: AI_KB_UPDATED,
        targetType: 'KNOWLEDGE_BASE',
        targetId: row.id,
        before: this.serialize(existing),
        after: this.serialize(row),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return row;
    });
    return this.serialize(updated);
  }

  async softDelete(actor: Actor, id: string, meta?: ReqMeta) {
    const existing = await this.prisma.knowledgeBaseEntry.findFirst({
      where: { id, companyId: actor.cid, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Knowledge base entry not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeBaseEntry.update({
        where: { id },
        data: { deletedAt: new Date(), active: false },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: AI_KB_DELETED,
        targetType: 'KNOWLEDGE_BASE',
        targetId: id,
        before: this.serialize(existing),
        after: null,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
    });

    return { id, deleted: true };
  }

  async listActiveKinds(companyId: string): Promise<Set<KnowledgeBaseKind>> {
    const rows = await this.prisma.knowledgeBaseEntry.findMany({
      where: { companyId, deletedAt: null, active: true },
      select: { kind: true },
      distinct: ['kind'],
    });
    return new Set(rows.map((r) => r.kind));
  }

  /** Compact KB text for future prompt grounding (11C). */
  async buildPromptContext(companyId: string): Promise<string> {
    const rows = await this.prisma.knowledgeBaseEntry.findMany({
      where: { companyId, deletedAt: null, active: true },
      orderBy: [{ sortOrder: 'asc' }, { kind: 'asc' }],
      take: 100,
    });
    const parts: string[] = [];
    let used = 0;
    for (const row of rows) {
      const chunk = `[${row.kind}] ${row.title}: ${row.body}`;
      if (used + chunk.length + 1 > AI_KB_PROMPT_BUDGET_CHARS) break;
      parts.push(chunk);
      used += chunk.length + 1;
    }
    return parts.join('\n');
  }

  private serialize(row: {
    id: string;
    companyId: string;
    kind: KnowledgeBaseKind;
    title: string;
    body: string;
    tags: string[];
    active: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      companyId: row.companyId,
      kind: row.kind,
      title: row.title,
      body: row.body,
      tags: row.tags,
      active: row.active,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
