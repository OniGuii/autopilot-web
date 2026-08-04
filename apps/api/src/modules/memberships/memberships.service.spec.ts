import { ConflictException, ForbiddenException } from '@nestjs/common';
import { MembershipRole, UserStatus } from '@prisma/client';
import { MembershipsService } from './memberships.service';

describe('MembershipsService', () => {
  const actor = { sub: 'owner-1', cid: 'co-1', role: 'OWNER' } as never;

  function build(opts?: {
    user?: unknown;
    membership?: unknown;
    ownerCount?: number;
  }) {
    const user = opts?.user ?? null;
    const membership = opts?.membership ?? null;
    const audit = { write: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const revocation = {
      onMembershipRevoked: jest.fn().mockResolvedValue({ revokedSessions: 2 }),
    };

    const tx = {
      user: {
        findFirst: jest.fn().mockResolvedValue(user),
        create: jest.fn().mockResolvedValue({
          id: 'u-new',
          email: 'new@acme.com',
          name: 'new',
          status: UserStatus.PENDING,
        }),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue(membership),
        create: jest.fn().mockResolvedValue({
          id: 'm-1',
          userId: 'u-new',
          role: MembershipRole.AGENT,
          status: 'INVITED',
          joinedAt: null,
          createdAt: new Date(),
          user: {
            id: 'u-new',
            email: 'new@acme.com',
            name: 'new',
            status: UserStatus.PENDING,
          },
        }),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(opts?.ownerCount ?? 1),
      },
      auditLog: { create: jest.fn() },
    };

    const prisma = {
      membership: {
        count: jest.fn().mockResolvedValue(opts?.ownerCount ?? 1),
        findFirst: jest.fn().mockResolvedValue(
          membership ?? {
            id: 'm-owner',
            userId: 'u-2',
            role: MembershipRole.OWNER,
            status: 'ACTIVE',
            joinedAt: new Date(),
            createdAt: new Date(),
            user: {
              id: 'u-2',
              email: 'o2@acme.com',
              name: 'O2',
              status: UserStatus.ACTIVE,
            },
          },
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (t: typeof tx) => Promise<unknown>)(tx);
        }
        return arg;
      }),
    };

    return {
      service: new MembershipsService(
        prisma as never,
        audit as never,
        revocation as never,
      ),
      audit,
      revocation,
      tx,
      prisma,
    };
  }

  it('creates INVITED membership without temporary password (D1)', async () => {
    const { service, audit } = build();
    const result = await service.create(actor, {
      email: 'new@acme.com',
      role: MembershipRole.AGENT,
    });
    expect(result.status).toBe('INVITED');
    expect(result.invite).toMatchObject({
      status: 'PENDING_INVITE',
      delivery: 'NONE',
      userCreated: true,
    });
    expect(result).not.toHaveProperty('temporaryPassword');
    expect(audit.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'MEMBERSHIP_CREATE' }),
    );
  });

  it('conflicts when membership already active', async () => {
    const { service } = build({
      user: {
        id: 'u-1',
        email: 'a@acme.com',
        name: 'A',
        status: UserStatus.ACTIVE,
      },
      membership: {
        id: 'm-1',
        status: 'ACTIVE',
        role: MembershipRole.AGENT,
      },
    });
    await expect(
      service.create(actor, {
        email: 'a@acme.com',
        role: MembershipRole.AGENT,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('protects last ACTIVE OWNER on revoke (D2)', async () => {
    const { service } = build({ ownerCount: 0 });
    await expect(service.revoke(actor, 'm-owner')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('revokes membership via AuthRevocationService (company-scoped)', async () => {
    const { service, revocation } = build({ ownerCount: 1 });
    const result = await service.revoke(actor, 'm-owner');
    expect(result.status).toBe('REVOKED');
    expect(revocation.onMembershipRevoked).toHaveBeenCalledWith('m-owner');
  });
});
