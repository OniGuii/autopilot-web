import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CompanyStatus,
  MembershipRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import {
  AUTH_MEMBERSHIP_CACHE_TTL_DEFAULT,
  MEMBERSHIP_STATUS_ACTIVE,
  authAccessCacheKey,
} from './auth.constants';
import type { AuthenticatedUser, JwtPayload } from './types/jwt-payload';

type AccessCachePayload = {
  userStatus: UserStatus;
  membershipId: string | null;
  membershipStatus: string | null;
  role: MembershipRole | null;
  companyId: string | null;
  companyStatus: CompanyStatus | null;
};

/**
 * Resolves the authenticated principal for each access JWT (Fase 6A).
 * Session is always loaded from DB; membership/user/company may use Redis cache (TTL 30s).
 */
@Injectable()
export class AccessPrincipalService {
  private readonly logger = new Logger(AccessPrincipalService.name);
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.cacheTtlSeconds = config.get<number>(
      'auth.membershipCacheTtlSeconds',
      AUTH_MEMBERSHIP_CACHE_TTL_DEFAULT,
    );
  }

  async resolveFromAccessToken(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub || !payload?.sid) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const session = await this.prisma.session.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        deletedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!session || session.user.deletedAt) {
      throw new UnauthorizedException('Session invalid');
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Session invalid');
    }

    // Session wins over stale JWT company claims (AH2).
    const boundMembershipId = session.membershipId;
    const boundCompanyId = session.companyId;

    if (payload.cid && boundCompanyId && payload.cid !== boundCompanyId) {
      throw new UnauthorizedException('Stale company context');
    }
    if (payload.mid && boundMembershipId && payload.mid !== boundMembershipId) {
      throw new UnauthorizedException('Stale membership context');
    }

    if (!boundMembershipId || !boundCompanyId) {
      // Pre select-company: only user+session.
      return {
        sub: payload.sub,
        sid: payload.sid,
        email: session.user.email,
      };
    }

    const access = await this.resolveMembershipAccess(
      payload.sub,
      boundMembershipId,
      boundCompanyId,
    );

    if (access.userStatus !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Session invalid');
    }
    if (
      access.membershipStatus !== MEMBERSHIP_STATUS_ACTIVE ||
      !access.role ||
      !access.companyId
    ) {
      throw new UnauthorizedException('Membership invalid');
    }
    if (access.companyStatus !== CompanyStatus.ACTIVE) {
      throw new UnauthorizedException('Company unavailable');
    }
    if (access.companyId !== boundCompanyId) {
      throw new UnauthorizedException('Membership invalid');
    }

    return {
      sub: payload.sub,
      sid: payload.sid,
      mid: access.membershipId ?? boundMembershipId,
      cid: access.companyId,
      role: access.role,
      email: session.user.email,
    };
  }

  /**
   * Load membership/role/user/company status — Redis cache AH11, DB fallback.
   */
  async resolveMembershipAccess(
    userId: string,
    membershipId: string,
    expectedCompanyId: string,
  ): Promise<AccessCachePayload> {
    const cacheKey = authAccessCacheKey(userId, membershipId);
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return cached;
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
        role: true,
        companyId: true,
        company: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
          },
        },
        user: {
          select: {
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (
      !membership ||
      membership.user.deletedAt ||
      membership.company.deletedAt ||
      membership.companyId !== expectedCompanyId
    ) {
      const negative: AccessCachePayload = {
        userStatus: UserStatus.DISABLED,
        membershipId,
        membershipStatus: null,
        role: null,
        companyId: expectedCompanyId,
        companyStatus: null,
      };
      // Do not cache negatives long — skip cache for invalid
      return negative;
    }

    const payload: AccessCachePayload = {
      userStatus: membership.user.status,
      membershipId: membership.id,
      membershipStatus: membership.status,
      role: membership.role,
      companyId: membership.company.id,
      companyStatus: membership.company.status,
    };

    await this.writeCache(cacheKey, payload);
    return payload;
  }

  /** Used by refresh path (no cache write required, but may warm cache). */
  async assertActiveMembershipForRefresh(input: {
    userId: string;
    membershipId: string;
    companyId: string;
  }): Promise<{ role: MembershipRole; companyId: string; membershipId: string }> {
    const access = await this.resolveMembershipAccess(
      input.userId,
      input.membershipId,
      input.companyId,
    );
    if (access.userStatus !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Session expired or revoked');
    }
    if (
      access.membershipStatus !== MEMBERSHIP_STATUS_ACTIVE ||
      !access.role ||
      access.companyStatus !== CompanyStatus.ACTIVE ||
      access.companyId !== input.companyId
    ) {
      throw new UnauthorizedException('Session expired or revoked');
    }
    return {
      role: access.role,
      companyId: access.companyId,
      membershipId: access.membershipId ?? input.membershipId,
    };
  }

  private async readCache(key: string): Promise<AccessCachePayload | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AccessCachePayload;
    } catch {
      this.logger.warn(`Invalid auth cache payload for ${key}`);
      return null;
    }
  }

  private async writeCache(
    key: string,
    payload: AccessCachePayload,
  ): Promise<void> {
    await this.redis.set(key, JSON.stringify(payload), this.cacheTtlSeconds);
  }
}
