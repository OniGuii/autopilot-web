import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCorrelationId } from '../../observability/request-context';

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
