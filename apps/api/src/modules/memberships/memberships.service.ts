import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipRole, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthRevocationService } from '../auth/auth-revocation.service';
import {
  MEMBERSHIP_STATUS_ACTIVE,
  MEMBERSHIP_STATUS_INVITED,
  MEMBERSHIP_STATUS_REVOKED,
} from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { ListMembershipsQueryDto } from './dto/list-memberships.query.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly revocation: AuthRevocationService,
  ) {}

  async list(actor: CompanyActor, query: ListMembershipsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.MembershipWhereInput = {
      companyId: actor.cid,
      deletedAt: null,
    };
    if (query.role) where.role = query.role;
    if (query.status) {
      where.status = query.status;
    } else {
      where.status = { not: MEMBERSHIP_STATUS_REVOKED };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.membership.count({ where }),
      this.prisma.membership.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, email: true, name: true, status: true } },
        },
      }),
    ]);

    return {
      data: rows.map((m) => this.toItem(m)),
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  /**
   * D1 — creates/reuses User without temporary password; Membership INVITED.
   * Future invite delivery is out of scope (response marks pendingInvite).
   */
  async create(
    actor: CompanyActor,
    dto: CreateMembershipDto,
    meta?: RequestMeta,
  ) {
    const email = dto.email.trim().toLowerCase();
    const name = dto.name?.trim() || email.split('@')[0] || 'Member';

    const result = await this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findFirst({
        where: { email, deletedAt: null },
      });
      let userCreated = false;

      if (!user) {
        user = await tx.user.create({
          data: {
            email,
            name,
            status: UserStatus.PENDING,
            passwordHash: null,
          },
        });
        userCreated = true;
        await this.audit.write(tx, {
          companyId: actor.cid,
          actorUserId: actor.sub,
          action: 'USER_CREATE',
          targetType: 'USER',
          targetId: user.id,
          before: null,
          after: {
            email: user.email,
            status: user.status,
            invitePrepared: true,
          },
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
      }

      const existing = await tx.membership.findFirst({
        where: {
          companyId: actor.cid,
          userId: user.id,
          deletedAt: null,
        },
      });

      if (existing && existing.status !== MEMBERSHIP_STATUS_REVOKED) {
        throw new ConflictException({
          code: 'MEMBERSHIP_EXISTS',
          message: 'User already has a membership in this company',
        });
      }

      let membership;
      if (existing) {
        membership = await tx.membership.update({
          where: { id: existing.id },
          data: {
            role: dto.role,
            status: MEMBERSHIP_STATUS_INVITED,
            invitedBy: actor.sub,
            joinedAt: null,
            deletedAt: null,
          },
          include: {
            user: {
              select: { id: true, email: true, name: true, status: true },
            },
          },
        });
      } else {
        membership = await tx.membership.create({
          data: {
            companyId: actor.cid,
            userId: user.id,
            role: dto.role,
            status: MEMBERSHIP_STATUS_INVITED,
            invitedBy: actor.sub,
          },
          include: {
            user: {
              select: { id: true, email: true, name: true, status: true },
            },
          },
        });
      }

      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: 'MEMBERSHIP_CREATE',
        targetType: 'MEMBERSHIP',
        targetId: membership.id,
        before: existing
          ? { status: existing.status, role: existing.role }
          : null,
        after: {
          status: membership.status,
          role: membership.role,
          userId: user.id,
          pendingInvite: true,
        },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return { membership, userCreated };
    });

    return {
      ...this.toItem(result.membership),
      invite: {
        status: 'PENDING_INVITE' as const,
        email,
        /** Placeholder for future e-mail/token invite delivery (D1). */
        delivery: 'NONE' as const,
        userCreated: result.userCreated,
      },
    };
  }

  async updateRole(
    actor: CompanyActor,
    membershipId: string,
    dto: UpdateMembershipDto,
    meta?: RequestMeta,
  ) {
    const membership = await this.requireMembership(actor.cid, membershipId);
    if (membership.status === MEMBERSHIP_STATUS_REVOKED) {
      throw new ConflictException('Cannot change role of revoked membership');
    }

    if (
      membership.role === MembershipRole.OWNER &&
      dto.role !== MembershipRole.OWNER
    ) {
      await this.assertNotLastActiveOwner(actor.cid, membership.id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.membership.update({
        where: { id: membership.id },
        data: { role: dto.role },
        include: {
          user: { select: { id: true, email: true, name: true, status: true } },
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: 'MEMBERSHIP_ROLE_CHANGE',
        targetType: 'MEMBERSHIP',
        targetId: row.id,
        before: { role: membership.role },
        after: { role: row.role },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return row;
    });

    return this.toItem(updated);
  }

  /** D2 — revoke membership in current company only (no global User disable). */
  async revoke(actor: CompanyActor, membershipId: string, meta?: RequestMeta) {
    const membership = await this.requireMembership(actor.cid, membershipId);
    if (membership.status === MEMBERSHIP_STATUS_REVOKED) {
      return {
        id: membership.id,
        status: MEMBERSHIP_STATUS_REVOKED,
        revokedSessions: 0,
      };
    }

    if (membership.role === MembershipRole.OWNER) {
      await this.assertNotLastActiveOwner(actor.cid, membership.id);
    }

    // Actor-attributed audit first; then central hook kills sessions + sets REVOKED.
    await this.prisma.$transaction(async (tx) => {
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: 'MEMBERSHIP_REVOKE',
        targetType: 'MEMBERSHIP',
        targetId: membership.id,
        before: { status: membership.status, role: membership.role },
        after: { status: MEMBERSHIP_STATUS_REVOKED },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
    });

    const { revokedSessions } =
      await this.revocation.onMembershipRevoked(membershipId);

    return {
      id: membership.id,
      status: MEMBERSHIP_STATUS_REVOKED,
      revokedSessions,
    };
  }

  private async requireMembership(companyId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, companyId, deletedAt: null },
      include: {
        user: { select: { id: true, email: true, name: true, status: true } },
      },
    });
    if (!membership) {
      throw new NotFoundException('Membership not found');
    }
    return membership;
  }

  private async assertNotLastActiveOwner(
    companyId: string,
    membershipId: string,
  ) {
    const owners = await this.prisma.membership.count({
      where: {
        companyId,
        role: MembershipRole.OWNER,
        status: MEMBERSHIP_STATUS_ACTIVE,
        deletedAt: null,
        id: { not: membershipId },
      },
    });
    if (owners === 0) {
      throw new ForbiddenException({
        code: 'LAST_OWNER_PROTECTED',
        message: 'Cannot remove or demote the last ACTIVE OWNER',
      });
    }
  }

  private toItem(m: {
    id: string;
    userId: string;
    role: MembershipRole;
    status: string;
    joinedAt: Date | null;
    createdAt: Date;
    user: { id: string; email: string; name: string; status: UserStatus };
  }) {
    return {
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      userStatus: m.user.status,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
      createdAt: m.createdAt,
    };
  }
}
