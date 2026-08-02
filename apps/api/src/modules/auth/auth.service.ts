import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  CompanyStatus,
  MembershipRole,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import type { AuthenticatedUser, JwtPayload } from './types/jwt-payload';

export type MembershipSummary = {
  membershipId: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  role: MembershipRole;
};

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

@Injectable()
export class AuthService {
  private readonly accessTtl: string;
  private readonly accessTtlSec: number;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessTtl = config.get<string>('jwt.accessTtl', '15m');
    this.accessTtlSec = ttlToSeconds(this.accessTtl);
    this.refreshTtlDays = config.get<number>('jwt.refreshTtlDays', 7);
  }

  async login(dto: LoginDto, meta?: RequestMeta) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: {
        memberships: {
          where: { status: 'ACTIVE', deletedAt: null },
          include: { company: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const memberships = this.mapMemberships(
      user.memberships.filter(
        (m) =>
          m.company.deletedAt === null &&
          m.company.status === CompanyStatus.ACTIVE &&
          m.company.slug,
      ),
    );

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        membershipId: null,
        companyId: null,
        ip: meta?.ip?.slice(0, 64),
        userAgent: meta?.userAgent?.slice(0, 512),
        expiresAt: this.refreshExpiresAt(),
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload = this.buildPayload({
      userId: user.id,
      sessionId: session.id,
      membershipId: null,
      companyId: null,
      role: null,
    });

    const accessToken = this.signAccessToken(payload);
    const refreshToken = await this.issueRefreshToken({
      userId: user.id,
      sessionId: session.id,
      membershipId: null,
      companyId: null,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: this.accessTtlSec,
      requiresCompanySelection: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      memberships,
      sessionId: session.id,
    };
  }

  async selectCompany(
    current: AuthenticatedUser,
    companySlug: string,
    meta?: RequestMeta,
  ) {
    if (!current.sid) {
      throw new UnauthorizedException('Session required');
    }

    const session = await this.prisma.session.findFirst({
      where: {
        id: current.sid,
        userId: current.sub,
        deletedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: current.sub,
        status: 'ACTIVE',
        deletedAt: null,
        company: {
          slug: companySlug,
          deletedAt: null,
          status: CompanyStatus.ACTIVE,
        },
      },
      include: { company: true },
    });

    if (!membership) {
      throw new ForbiddenException('No active membership for this company');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        membershipId: membership.id,
        companyId: membership.companyId,
        ip: meta?.ip?.slice(0, 64) ?? session.ip,
        userAgent: meta?.userAgent?.slice(0, 512) ?? session.userAgent,
      },
    });

    await this.revokeActiveRefreshTokens(session.id);

    const payload = this.buildPayload({
      userId: current.sub,
      sessionId: session.id,
      membershipId: membership.id,
      companyId: membership.companyId,
      role: membership.role,
    });

    const accessToken = this.signAccessToken(payload);
    const refreshToken = await this.issueRefreshToken({
      userId: current.sub,
      sessionId: session.id,
      membershipId: membership.id,
      companyId: membership.companyId,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: this.accessTtlSec,
      requiresCompanySelection: false,
      company: {
        id: membership.company.id,
        name: membership.company.name,
        slug: membership.company.slug,
      },
      membership: {
        id: membership.id,
        role: membership.role,
      },
      sessionId: session.id,
    };
  }

  async refresh(rawRefreshToken: string) {
    const parsed = this.parseRefreshToken(rawRefreshToken);
    if (!parsed) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const existing = await this.prisma.refreshToken.findFirst({
      where: {
        id: parsed.id,
        deletedAt: null,
      },
      include: {
        session: {
          include: {
            membership: true,
            user: true,
          },
        },
      },
    });

    if (!existing || existing.revokedAt || existing.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const secretOk = await argon2.verify(existing.tokenHash, parsed.secret);
    if (!secretOk) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = existing.session;
    if (
      !session ||
      session.deletedAt ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE ||
      session.user.deletedAt
    ) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    // Mandatory rotation — create next token first (FK replaced_by_id).
    const nextId = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = await argon2.hash(secret);

    const membership = session.membership;
    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          id: nextId,
          userId: session.userId,
          sessionId: session.id,
          membershipId: membership?.id ?? session.membershipId,
          companyId: membership?.companyId ?? session.companyId,
          tokenHash,
          expiresAt: this.refreshExpiresAt(),
        },
      }),
      this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: {
          revokedAt: new Date(),
          replacedById: nextId,
        },
      }),
    ]);

    const payload = this.buildPayload({
      userId: session.userId,
      sessionId: session.id,
      membershipId: membership?.id ?? session.membershipId,
      companyId: membership?.companyId ?? session.companyId,
      role: membership?.role ?? null,
    });

    return {
      accessToken: this.signAccessToken(payload),
      refreshToken: `${nextId}.${secret}`,
      tokenType: 'Bearer' as const,
      expiresIn: this.accessTtlSec,
      requiresCompanySelection: !(membership?.id ?? session.membershipId),
      sessionId: session.id,
    };
  }

  async logout(rawRefreshToken: string) {
    const parsed = this.parseRefreshToken(rawRefreshToken);
    if (!parsed) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const existing = await this.prisma.refreshToken.findFirst({
      where: { id: parsed.id, deletedAt: null },
    });

    if (!existing) {
      // Idempotent logout
      return { ok: true };
    }

    const secretOk = await argon2.verify(existing.tokenHash, parsed.secret);
    if (!secretOk) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { sessionId: existing.sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.session.updateMany({
        where: { id: existing.sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    return { ok: true };
  }

  async me(current: AuthenticatedUser) {
    const user = await this.prisma.user.findFirst({
      where: { id: current.sub, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        memberships: {
          where: { status: 'ACTIVE', deletedAt: null },
          include: {
            company: {
              select: { id: true, name: true, slug: true, status: true, deletedAt: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User not found');
    }

    const activeMemberships = user.memberships.filter(
      (m) =>
        m.company.deletedAt === null &&
        m.company.status === CompanyStatus.ACTIVE &&
        m.company.slug,
    );

    const activeMembership = current.mid
      ? activeMemberships.find((m) => m.id === current.mid)
      : null;

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
      },
      sessionId: current.sid,
      company: activeMembership
        ? {
            id: activeMembership.company.id,
            name: activeMembership.company.name,
            slug: activeMembership.company.slug,
          }
        : null,
      membership: activeMembership
        ? {
            id: activeMembership.id,
            role: activeMembership.role,
          }
        : null,
      memberships: this.mapMemberships(activeMemberships),
      claims: {
        sub: current.sub,
        sid: current.sid,
        mid: current.mid ?? null,
        cid: current.cid ?? null,
        role: current.role ?? null,
      },
    };
  }

  private mapMemberships(
    memberships: Array<{
      id: string;
      role: MembershipRole;
      companyId: string;
      company: { id: string; name: string; slug: string | null };
    }>,
  ): MembershipSummary[] {
    return memberships
      .filter((m) => Boolean(m.company.slug))
      .map((m) => ({
        membershipId: m.id,
        companyId: m.companyId,
        companyName: m.company.name,
        companySlug: m.company.slug as string,
        role: m.role,
      }));
  }

  private buildPayload(input: {
    userId: string;
    sessionId: string;
    membershipId: string | null;
    companyId: string | null;
    role: MembershipRole | null;
  }): JwtPayload {
    const payload: JwtPayload = {
      sub: input.userId,
      sid: input.sessionId,
    };
    if (input.membershipId) payload.mid = input.membershipId;
    if (input.companyId) payload.cid = input.companyId;
    if (input.role) payload.role = input.role;
    return payload;
  }

  private signAccessToken(payload: JwtPayload): string {
    return this.jwt.sign({ ...payload });
  }

  private async issueRefreshToken(input: {
    userId: string;
    sessionId: string;
    membershipId: string | null;
    companyId: string | null;
  }): Promise<string> {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = await argon2.hash(secret);

    await this.prisma.refreshToken.create({
      data: {
        id,
        userId: input.userId,
        sessionId: input.sessionId,
        membershipId: input.membershipId,
        companyId: input.companyId,
        tokenHash,
        expiresAt: this.refreshExpiresAt(),
      },
    });

    return `${id}.${secret}`;
  }

  private parseRefreshToken(
    raw: string,
  ): { id: string; secret: string } | null {
    const dot = raw.indexOf('.');
    if (dot <= 0 || dot === raw.length - 1) return null;
    const id = raw.slice(0, dot);
    const secret = raw.slice(dot + 1);
    if (!id || !secret) return null;
    return { id, secret };
  }

  private async revokeActiveRefreshTokens(sessionId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private refreshExpiresAt(): Date {
    return new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
  }
}

function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return 900;
  const value = Number(match[1]);
  switch (match[2]) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    default:
      return 900;
  }
}
