import { UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

jest.mock('argon2', () => ({
  hash: jest.fn(async () => 'hashed'),
  verify: jest.fn(async () => true),
}));

describe('AuthService hardening (6A)', () => {
  const userId = 'user-1';
  const sessionId = 'session-1';
  const tokenId = '11111111-1111-1111-1111-111111111111';

  function buildAuth(opts?: {
    activeSessions?: Array<{ id: string }>;
    refresh?: Record<string, unknown> | null;
  }) {
    const accessPrincipal = {
      assertActiveMembershipForRefresh: jest.fn().mockResolvedValue({
        role: 'OWNER',
        companyId: 'company-1',
        membershipId: 'mem-1',
      }),
    };
    const revocation = {
      logoutAllDevices: jest.fn().mockResolvedValue({ revokedSessions: 3 }),
      revokeSession: jest.fn().mockResolvedValue(undefined),
      invalidateAccessCacheForUser: jest.fn().mockResolvedValue(undefined),
    };
    const jwt = {
      sign: jest.fn(() => 'access.jwt'),
    };
    const config = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'jwt.accessTtl') return '15m';
        if (key === 'jwt.refreshTtlDays') return 7;
        if (key === 'auth.maxSessionsPerUser') return 5;
        return def;
      }),
    };

    const refreshRow =
      opts?.refresh === undefined
        ? {
            id: tokenId,
            tokenHash: 'hashed',
            revokedAt: null,
            replacedById: null,
            expiresAt: new Date(Date.now() + 60_000),
            sessionId,
            session: {
              id: sessionId,
              userId,
              membershipId: 'mem-1',
              companyId: 'company-1',
              deletedAt: null,
              revokedAt: null,
              expiresAt: new Date(Date.now() + 60_000),
              membership: { role: 'OWNER', status: 'ACTIVE', deletedAt: null },
              user: {
                status: UserStatus.ACTIVE,
                deletedAt: null,
              },
            },
          }
        : opts.refresh;

    const prisma = {
      session: {
        findMany: jest.fn().mockResolvedValue(opts?.activeSessions ?? []),
        create: jest.fn().mockResolvedValue({
          id: sessionId,
          userId,
        }),
        findFirst: jest.fn().mockResolvedValue({ userId }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: {
        findFirst: jest.fn().mockResolvedValue(refreshRow),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: userId,
          email: 'a@test.dev',
          name: 'A',
          status: UserStatus.ACTIVE,
          passwordHash: 'hashed',
          memberships: [],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
    };

    const service = new AuthService(
      prisma as never,
      jwt as never,
      accessPrincipal as never,
      revocation as never,
      config as never,
    );

    return { service, prisma, revocation, accessPrincipal };
  }

  it('enforceSessionConcurrencyLimit revokes oldest overflow sessions', async () => {
    const activeSessions = Array.from({ length: 5 }, (_, i) => ({
      id: `s-${i}`,
    }));
    const { service, revocation, prisma } = buildAuth({ activeSessions });

    // login path triggers concurrency before create
    (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
    await service.login(
      { email: 'a@test.dev', password: 'x' },
      { ip: '1.1.1.1' },
    );

    expect(prisma.session.findMany).toHaveBeenCalled();
    // 5 active + new login → revoke 1 oldest
    expect(revocation.revokeSession).toHaveBeenCalledWith(
      's-0',
      'MAX_SESSIONS',
    );
  });

  it('refresh reuse of rotated token revokes session', async () => {
    const { service, revocation } = buildAuth({
      refresh: {
        id: tokenId,
        tokenHash: 'hashed',
        revokedAt: new Date(),
        replacedById: 'next-id',
        expiresAt: new Date(Date.now() + 60_000),
        sessionId,
        session: {
          id: sessionId,
          userId,
          membershipId: null,
          companyId: null,
          deletedAt: null,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          membership: null,
          user: { status: UserStatus.ACTIVE, deletedAt: null },
        },
      },
    });

    await expect(service.refresh(`${tokenId}.secret`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(revocation.revokeSession).toHaveBeenCalledWith(
      sessionId,
      'REFRESH_REUSE',
    );
  });

  it('logoutAll delegates to AuthRevocationService', async () => {
    const { service, revocation } = buildAuth();
    const result = await service.logoutAll({
      sub: userId,
      sid: sessionId,
      cid: 'company-1',
    });
    expect(result).toEqual({ ok: true, revokedSessions: 3 });
    expect(revocation.logoutAllDevices).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ companyId: 'company-1' }),
    );
  });

  it('refresh revalidates membership via AccessPrincipalService', async () => {
    const { service, accessPrincipal } = buildAuth();
    const tokens = await service.refresh(`${tokenId}.secret`);
    expect(tokens.accessToken).toBe('access.jwt');
    expect(
      accessPrincipal.assertActiveMembershipForRefresh,
    ).toHaveBeenCalledWith({
      userId,
      membershipId: 'mem-1',
      companyId: 'company-1',
    });
  });
});
