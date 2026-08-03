import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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

/**
 * Audit helper — callers must invoke inside the same Prisma transaction
 * as the business mutation.
 */
@Injectable()
export class AuditService {
  write(
    tx: Prisma.TransactionClient,
    input: AuditWriteInput,
  ): Promise<{ id: string }> {
    return tx.auditLog.create({
      data: {
        companyId: input.companyId,
        actorType: input.actorUserId ? 'USER' : 'SYSTEM',
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        before: input.before ?? Prisma.JsonNull,
        after: input.after ?? Prisma.JsonNull,
        ip: input.ip?.slice(0, 64),
        userAgent: input.userAgent?.slice(0, 512),
      },
      select: { id: true },
    });
  }
}
