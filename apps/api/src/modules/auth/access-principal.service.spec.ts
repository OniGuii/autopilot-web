import { UnauthorizedException } from '@nestjs/common';
import { CompanyStatus, UserStatus } from '@prisma/client';
import { AccessPrincipalService } from './access-principal.service';
import { authAccessCacheKey } from './auth.constants';

describe('AccessPrincipalService', () => {
  const userId = 'user-1';
  const sessionId = 'session-1';
  const membershipId = 'mem-1';
  const companyId = 'company-1';

  function build(opts?: {
    session?: Record<string, unknown> | null;
    membership?: Record<string, unknown> | null;
    cacheRaw?: string | null;
  }) {
    const redis = {
      get: jest.fn().mockResolvedValue(opts?.cacheRaw ?? null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      deleteByPattern: jest.fn().mockResolvedValue(0),
    };
    const prisma = {
      session: {
        findFirst: jest.fn().mockResolvedValue(
          opts?.session === undefined
            ? {
                id: sessionId,
                userId,
                membershipId,
                companyId,
                deletedAt: null,
                revokedAt: null,
                expiresAt: new Date(Date.now() + 60_000),
                user: {
                  id: userId,
                  email: 'a@test.dev',
                  status: UserStatus.ACTIVE,
                  deletedAt: null,
                },
              }
            : opts.session,
        ),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue(
          opts?.membership === undefined
            ? {
                id: membershipId,
                status: 'ACTIVE',
                role: 'OWNER',
                companyId,
                company: {
                  id: companyId,
                  status: CompanyStatus.ACTIVE,
                  deletedAt: null,
                },
                user: { status: UserStatus.ACTIVE, deletedAt: null },
              }
            : opts.membership,
        ),
      },
    };
    const config = {
      get: jest.fn((_key: string, def: number) => def),
    };
    const service = new AccessPrincipalService(
      prisma as never,
      redis as never,
      config as never,
    );
    return { service, prisma, redis };
  }

  it('resolveFromAccessToken uses DB session and caches membership access', async () => {
    const { service, redis, prisma } = build();
    const user = await service.resolveFromAccessToken({
      sub: userId,
      sid: sessionId,
      mid: membershipId,
      cid: companyId,
      role: 'OWNER',
    });

    expect(user).toMatchObject({
      sub: userId,
      sid: sessionId,
      mid: membershipId,
      cid: companyId,
      role: 'OWNER',
    });
    expect(prisma.membership.findFirst).toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(
      authAccessCacheKey(userId, membershipId),
      expect.any(String),
      30,
    );
  });

  it('hits Redis cache and skips membership DB query', async () => {
    const cached = JSON.stringify({
      userStatus: UserStatus.ACTIVE,
      membershipId,
      membershipStatus: 'ACTIVE',
      role: 'ADMIN',
      companyId,
      companyStatus: CompanyStatus.ACTIVE,
    });
    const { service, prisma, redis } = build({ cacheRaw: cached });
    const user = await service.resolveFromAccessToken({
      sub: userId,
      sid: sessionId,
      mid: membershipId,
      cid: companyId,
    });
    expect(user.role).toBe('ADMIN');
    expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalled();
  });

  it('rejects revoked membership', async () => {
    const { service } = build({
      membership: {
        id: membershipId,
        status: 'REVOKED',
        role: 'OWNER',
        companyId,
        company: {
          id: companyId,
          status: CompanyStatus.ACTIVE,
          deletedAt: null,
        },
        user: { status: UserStatus.ACTIVE, deletedAt: null },
      },
    });
    await expect(
      service.resolveFromAccessToken({
        sub: userId,
        sid: sessionId,
        mid: membershipId,
        cid: companyId,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects suspended company', async () => {
    const { service } = build({
      membership: {
        id: membershipId,
        status: 'ACTIVE',
        role: 'OWNER',
        companyId,
        company: {
          id: companyId,
          status: CompanyStatus.SUSPENDED,
          deletedAt: null,
        },
        user: { status: UserStatus.ACTIVE, deletedAt: null },
      },
    });
    await expect(
      service.resolveFromAccessToken({
        sub: userId,
        sid: sessionId,
        mid: membershipId,
        cid: companyId,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects disabled user from session load', async () => {
    const { service } = build({
      session: {
        id: sessionId,
        userId,
        membershipId,
        companyId,
        deletedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: userId,
          email: 'a@test.dev',
          status: UserStatus.DISABLED,
          deletedAt: null,
        },
      },
    });
    await expect(
      service.resolveFromAccessToken({
        sub: userId,
        sid: sessionId,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects stale JWT company vs session company', async () => {
    const { service } = build();
    await expect(
      service.resolveFromAccessToken({
        sub: userId,
        sid: sessionId,
        mid: membershipId,
        cid: 'other-company',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('pre select-company returns principal without mid/cid', async () => {
    const { service, prisma } = build({
      session: {
        id: sessionId,
        userId,
        membershipId: null,
        companyId: null,
        deletedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: userId,
          email: 'a@test.dev',
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
      },
    });
    const user = await service.resolveFromAccessToken({
      sub: userId,
      sid: sessionId,
    });
    expect(user).toEqual({
      sub: userId,
      sid: sessionId,
      email: 'a@test.dev',
    });
    expect(prisma.membership.findFirst).not.toHaveBeenCalled();
  });
});
