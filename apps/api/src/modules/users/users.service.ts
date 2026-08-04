import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRevocationService } from '../auth/auth-revocation.service';
import {
  MEMBERSHIP_STATUS_ACTIVE,
  MEMBERSHIP_STATUS_INVITED,
} from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { MembershipsService } from '../memberships/memberships.service';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

/**
 * User administration for pilot (D2):
 * - No global User.status disable
 * - Revoke = membership revoke in current company
 * - logout-all / sessions scoped to current company
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revocation: AuthRevocationService,
    private readonly memberships: MembershipsService,
  ) {}

  async listSessions(actor: CompanyActor, userId: string) {
    await this.requireCompanyMembership(actor.cid, userId);
    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        companyId: actor.cid,
        revokedAt: null,
        deletedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        ip: true,
        userAgent: true,
        membershipId: true,
      },
    });

    return {
      items: sessions.map((s) => ({
        ...s,
        current: false,
      })),
    };
  }

  /** Company-scoped remote logout (D2 — does not revoke other companies). */
  async logoutAllInCompany(
    actor: CompanyActor,
    userId: string,
    meta?: RequestMeta,
  ) {
    await this.requireCompanyMembership(actor.cid, userId);
    const result = await this.revocation.logoutCompanyDevices(
      userId,
      actor.cid,
      {
        actorUserId: actor.sub,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      },
    );
    return { ok: true as const, revokedSessions: result.revokedSessions };
  }

  /**
   * D2 disable equivalent: revoke membership in current company only.
   */
  async revokeAccess(
    actor: CompanyActor,
    userId: string,
    meta?: RequestMeta,
  ) {
    const membership = await this.requireCompanyMembership(actor.cid, userId, {
      includeRevoked: false,
    });
    return this.memberships.revoke(actor, membership.id, meta);
  }

  private async requireCompanyMembership(
    companyId: string,
    userId: string,
    opts?: { includeRevoked?: boolean },
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        companyId,
        userId,
        deletedAt: null,
        ...(opts?.includeRevoked
          ? {}
          : {
              status: {
                in: [MEMBERSHIP_STATUS_ACTIVE, MEMBERSHIP_STATUS_INVITED],
              },
            }),
      },
      select: { id: true, status: true, role: true },
    });
    if (!membership) {
      throw new NotFoundException('User not found in this company');
    }
    return membership;
  }
}
