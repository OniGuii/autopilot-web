import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCorrelationId } from '../../observability/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditQueryDto } from '../ops/dto/list-audit.query.dto';

export type AuditWriteInput = {
  companyId: string;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  ip?: string;
  userAgent?: string;
};

/** Loose tx shape — works with base and extended Prisma transaction clients. */
export type AuditTransaction = {
  auditLog: {
    create: (args: {
      data: Prisma.AuditLogUncheckedCreateInput;
      select: { id: true };
    }) => Promise<{ id: string }>;
  };
};

/**
 * Audit helper — callers must invoke inside the same Prisma transaction
 * as the business mutation.
 *
 * 8A: injects correlationId into `after` JSON when present in request context
 * (no schema change).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  write(tx: AuditTransaction, input: AuditWriteInput): Promise<{ id: string }> {
    const correlationId = getCorrelationId();
    const after = mergeCorrelation(input.after, correlationId);

    return tx.auditLog.create({
      data: {
        companyId: input.companyId,
        actorType: input.actorUserId ? 'USER' : 'SYSTEM',
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        before: input.before ?? Prisma.JsonNull,
        after: after ?? Prisma.JsonNull,
        ip: input.ip?.slice(0, 64),
        userAgent: input.userAgent?.slice(0, 512),
      },
      select: { id: true },
    });
  }

  /** Audit Explorer V2 list (shared by /api/ops/audit and /api/audit). */
  async listForCompany(companyId: string, query: ListAuditQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AuditLogWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.action) {
      where.action = query.action;
    } else if (query.actionPrefix) {
      where.action = { startsWith: query.actionPrefix };
    }

    const actorUserId = query.actorUserId ?? query.userId;
    if (actorUserId) where.actorUserId = actorUserId;

    const targetType = query.targetType ?? query.entity;
    if (targetType) where.targetType = targetType;
    if (query.targetId) where.targetId = query.targetId;

    if (query.from || query.to) {
      where.occurredAt = {};
      if (query.from) where.occurredAt.gte = query.from;
      if (query.to) where.occurredAt.lte = query.to;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          companyId: true,
          actorType: true,
          actorUserId: true,
          action: true,
          targetType: true,
          targetId: true,
          occurredAt: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async getForCompany(companyId: string, id: string) {
    const row = await this.prisma.auditLog.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException('Audit log not found');
    }
    return row;
  }
}

function mergeCorrelation(
  after: Prisma.InputJsonValue | null | undefined,
  correlationId: string | undefined,
): Prisma.InputJsonValue | null | undefined {
  if (!correlationId) return after;
  if (after == null) {
    return { correlationId };
  }
  if (typeof after === 'object' && !Array.isArray(after)) {
    return {
      ...(after as Record<string, unknown>),
      correlationId,
    };
  }
  return {
    value: after,
    correlationId,
  };
}
