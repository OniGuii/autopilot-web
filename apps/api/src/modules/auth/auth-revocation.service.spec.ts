import { AuthRevocationService } from './auth-revocation.service';
import {
  authAccessCacheKey,
  authAccessCacheUserPattern,
} from './auth.constants';

describe('AuthRevocationService', () => {
  const userId = 'user-1';
  const membershipId = 'mem-1';
  const companyId = 'company-1';
  const sessionId = 'session-1';

  function build() {
    const redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn().mockResolvedValue(undefined),
      deleteByPattern: jest.fn().mockResolvedValue(1),
    };
    const audit = { write: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return arg({});
        }
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        return arg;
      }),
      session: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        findFirst: jest.fn().mockResolvedValue({
          id: sessionId,
          userId,
          membershipId,
          companyId,
        }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: sessionId, userId, membershipId }]),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: membershipId,
          userId,
          companyId,
          status: 'ACTIVE',
        }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ id: membershipId, userId }]),
      },
    };
    const service = new AuthRevocationService(
      prisma as never,
      redis as never,
      audit as never,
    );
    return { service, prisma, redis, audit };
  }

  it('logoutAllDevices revokes sessions/tokens and busts user cache', async () => {
    const { service, redis } = build();
    const result = await service.logoutAllDevices(userId, {
      companyId,
      actorUserId: userId,
    });
    expect(result.revokedSessions).toBe(2);
    expect(redis.deleteByPattern).toHaveBeenCalledWith(
      authAccessCacheUserPattern(userId),
    );
    expect(redis.del).toHaveBeenCalledWith(authAccessCacheKey(userId, null));
  });

  it('revokeSession marks session + refresh revoked and invalidates cache', async () => {
    const { service, prisma, redis } = build();
    await service.revokeSession(sessionId, 'REFRESH_REUSE');
    expect(prisma.session.updateMany).toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(redis.deleteByPattern).toHaveBeenCalledWith(
      authAccessCacheUserPattern(userId),
    );
  });

  it('onMembershipRevoked sets REVOKED, kills sessions, busts cache', async () => {
    const { service, prisma, redis } = build();
    const result = await service.onMembershipRevoked(membershipId);
    expect(result.revokedSessions).toBe(2);
    expect(prisma.membership.update).toHaveBeenCalledWith({
      where: { id: membershipId },
      data: { status: 'REVOKED' },
    });
    expect(redis.del).toHaveBeenCalledWith(
      authAccessCacheKey(userId, membershipId),
    );
  });

  it('onUserDisabled delegates to logout-all', async () => {
    const { service, redis } = build();
    const result = await service.onUserDisabled(userId);
    expect(result.revokedSessions).toBe(2);
    expect(redis.deleteByPattern).toHaveBeenCalled();
  });

  it('onCompanySuspended revokes bound sessions and busts membership caches', async () => {
    const { service, prisma, redis } = build();
    const result = await service.onCompanySuspended(companyId);
    expect(result.revokedSessions).toBe(2);
    expect(prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId }),
      }),
    );
    expect(redis.del).toHaveBeenCalledWith(
      authAccessCacheKey(userId, membershipId),
    );
  });
});
