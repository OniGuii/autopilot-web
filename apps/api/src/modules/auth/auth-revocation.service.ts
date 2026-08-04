import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import {
  MEMBERSHIP_STATUS_REVOKED,
  authAccessCacheKey,
  authAccessCacheUserPattern,
} from './auth.constants';

/**
 * Central revocation + AH11 cache invalidation hooks (Fase 6A).
 * Callable by AuthService and future admin APIs.
 */
@Injectable()
export class AuthRevocationService {
  private readonly logger = new Logger(AuthRevocationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Pilot D2 — revoke sessions/refresh tokens bound to one company only.
   * Does not affect the user's sessions in other tenants.
   */
  async logoutCompanyDevices(
    userId: string,
    companyId: string,
    meta?: {
      actorUserId?: string;
      ip?: string;
      userAgent?: string;
    },
  ): Promise<{ revokedSessions: number }> {
    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        companyId,
        revokedAt: null,
        deletedAt: null,
      },
      select: { id: true, membershipId: true },
    });

    const result = await this.prisma.session.updateMany({
      where: {
        userId,
        companyId,
        revokedAt: null,
        deletedAt: null,
      },
      data: { revokedAt: now },
    });

    if (sessions.length > 0) {
      await this.prisma.refreshToken.updateMany({
        where: {
          sessionId: { in: sessions.map((s) => s.id) },
          revokedAt: null,
          deletedAt: null,
        },
        data: { revokedAt: now },
      });
    }

    const membershipIds = [
      ...new Set(
        sessions
          .map((s) => s.membershipId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    for (const membershipId of membershipIds) {
      await this.invalidateAccessCacheForMembership(userId, membershipId);
    }
    await this.invalidateAccessCacheForUser(userId);

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.write(tx, {
          companyId,
          actorUserId: meta?.actorUserId ?? userId,
          action: 'USER_LOGOUT_ALL_COMPANY',
          targetType: 'USER',
          targetId: userId,
          before: null,
          after: { revokedSessions: result.count, scope: 'company' },
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
      });
    } catch (err) {
      this.logger.warn(
        `USER_LOGOUT_ALL_COMPANY audit failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { revokedSessions: result.count };
  }

  async logoutAllDevices(userId: string, meta?: {
    actorUserId?: string;
    companyId?: string | null;
    ip?: string;
    userAgent?: string;
  }): Promise<{ revokedSessions: number }> {
    const now = new Date();
    const [sessions, tokens] = await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null, deletedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null, deletedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    await this.invalidateAccessCacheForUser(userId);

    if (meta?.companyId) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.audit.write(tx, {
            companyId: meta.companyId!,
            actorUserId: meta.actorUserId ?? userId,
            action: 'AUTH_LOGOUT_ALL',
            targetType: 'USER',
            targetId: userId,
            before: null,
            after: {
              revokedSessions: sessions.count,
              revokedRefreshTokens: tokens.count,
            },
            ip: meta.ip,
            userAgent: meta.userAgent,
          });
        });
      } catch (err) {
        this.logger.warn(
          `AUTH_LOGOUT_ALL audit failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return { revokedSessions: sessions.count };
  }

  async revokeSession(
    sessionId: string,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, deletedAt: null },
      select: { id: true, userId: true, membershipId: true, companyId: true },
    });
    if (!session) return;

    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    await this.invalidateAccessCacheForUser(session.userId);
    this.logger.warn(
      `Session revoked session=${sessionId} reason=${reason} user=${session.userId}`,
    );
  }

  /**
   * Hook: membership revoke — mark REVOKED (if still active), kill sessions, bust cache.
   */
  async onMembershipRevoked(membershipId: string): Promise<{
    revokedSessions: number;
  }> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId },
      select: { id: true, userId: true, companyId: true, status: true },
    });
    if (!membership) {
      return { revokedSessions: 0 };
    }

    if (membership.status !== MEMBERSHIP_STATUS_REVOKED) {
      await this.prisma.membership.update({
        where: { id: membershipId },
        data: { status: MEMBERSHIP_STATUS_REVOKED },
      });
    }

    const now = new Date();
    const result = await this.prisma.session.updateMany({
      where: {
        membershipId,
        revokedAt: null,
        deletedAt: null,
      },
      data: { revokedAt: now },
    });

    const sessionIds = (
      await this.prisma.session.findMany({
        where: { membershipId },
        select: { id: true },
      })
    ).map((s) => s.id);

    if (sessionIds.length > 0) {
      await this.prisma.refreshToken.updateMany({
        where: { sessionId: { in: sessionIds }, revokedAt: null },
        data: { revokedAt: now },
      });
    }

    await this.invalidateAccessCacheForMembership(
      membership.userId,
      membershipId,
    );
    await this.invalidateAccessCacheForUser(membership.userId);

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.write(tx, {
          companyId: membership.companyId,
          actorUserId: null,
          action: 'MEMBERSHIP_REVOKED',
          targetType: 'MEMBERSHIP',
          targetId: membershipId,
          before: { status: membership.status },
          after: {
            status: MEMBERSHIP_STATUS_REVOKED,
            revokedSessions: result.count,
          },
        });
      });
    } catch (err) {
      this.logger.warn(
        `MEMBERSHIP_REVOKED audit failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { revokedSessions: result.count };
  }

  /** Hook: user disable — logout-all + cache bust. */
  async onUserDisabled(userId: string): Promise<{ revokedSessions: number }> {
    const result = await this.logoutAllDevices(userId, { actorUserId: userId });
    try {
      const anySession = await this.prisma.session.findFirst({
        where: { userId },
        select: { companyId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (anySession?.companyId) {
        await this.prisma.$transaction(async (tx) => {
          await this.audit.write(tx, {
            companyId: anySession.companyId!,
            actorUserId: null,
            action: 'USER_DISABLED',
            targetType: 'USER',
            targetId: userId,
            before: null,
            after: { revokedSessions: result.revokedSessions },
          });
        });
      }
    } catch (err) {
      this.logger.warn(
        `USER_DISABLED audit failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    return result;
  }

  /** Hook: company suspend — revoke bound sessions + cache bust. */
  async onCompanySuspended(companyId: string): Promise<{
    revokedSessions: number;
  }> {
    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: { companyId, revokedAt: null, deletedAt: null },
      select: { id: true, userId: true, membershipId: true },
    });

    const result = await this.prisma.session.updateMany({
      where: { companyId, revokedAt: null, deletedAt: null },
      data: { revokedAt: now },
    });

    if (sessions.length > 0) {
      await this.prisma.refreshToken.updateMany({
        where: {
          sessionId: { in: sessions.map((s) => s.id) },
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    }

    const userIds = [...new Set(sessions.map((s) => s.userId))];
    for (const userId of userIds) {
      await this.invalidateAccessCacheForUser(userId);
    }

    // Also bust cache for all memberships of this company.
    const memberships = await this.prisma.membership.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, userId: true },
    });
    for (const m of memberships) {
      await this.invalidateAccessCacheForMembership(m.userId, m.id);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.write(tx, {
          companyId,
          actorUserId: null,
          action: 'COMPANY_SUSPENDED',
          targetType: 'COMPANY',
          targetId: companyId,
          before: null,
          after: { revokedSessions: result.count },
        });
      });
    } catch (err) {
      this.logger.warn(
        `COMPANY_SUSPENDED audit failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { revokedSessions: result.count };
  }

  async invalidateAccessCacheForUser(userId: string): Promise<void> {
    await this.redis.deleteByPattern(authAccessCacheUserPattern(userId));
    await this.redis.del(authAccessCacheKey(userId, null));
  }

  async invalidateAccessCacheForMembership(
    userId: string,
    membershipId: string,
  ): Promise<void> {
    await this.redis.del(authAccessCacheKey(userId, membershipId));
  }
}
