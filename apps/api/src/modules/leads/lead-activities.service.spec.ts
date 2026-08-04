import { BadRequestException } from '@nestjs/common';
import { LeadActivityStatus, LeadActivityType } from '@prisma/client';
import { LeadActivitiesService } from './lead-activities.service';

describe('LeadActivitiesService', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const leadId = '22222222-2222-2222-2222-222222222222';
  const actor = {
    sub: 'user-1',
    cid: companyId,
    mid: 'mem-1',
    role: 'AGENT',
  } as never;

  const base = {
    id: 'act-1',
    companyId,
    leadId,
    userId: 'user-1',
    type: LeadActivityType.CALL,
    status: LeadActivityStatus.PLANNED,
    title: 'Call lead',
    body: null,
    scheduledAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  function build(overrides?: Partial<typeof base>) {
    let stored = { ...base, ...(overrides ?? {}) };
    const audits: unknown[] = [];

    const prisma = {
      lead: { findFirst: jest.fn().mockResolvedValue({ id: leadId }) },
      membership: {
        findFirst: jest.fn().mockResolvedValue({ id: 'mem-1' }),
      },
      leadActivity: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          stored = {
            ...stored,
            ...data,
            id: 'act-1',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          return { ...stored };
        }),
        findFirst: jest
          .fn()
          .mockImplementation(async () =>
            stored.deletedAt ? null : { ...stored },
          ),
        findMany: jest.fn().mockResolvedValue([stored]),
        update: jest.fn().mockImplementation(async ({ data }) => {
          const next = { ...stored };
          if (data.user?.disconnect) next.userId = null;
          if (data.user?.connect?.id) next.userId = data.user.connect.id;
          Object.assign(next, {
            ...data,
            user: undefined,
            updatedAt: new Date(),
          });
          stored = next;
          return { ...stored };
        }),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ leadActivity: prisma.leadActivity, auditLog: {} }),
      ),
    };

    const audit = {
      write: jest.fn(async (_tx: unknown, input: unknown) => {
        audits.push(input);
        return { id: 'a' };
      }),
    };

    return {
      service: new LeadActivitiesService(prisma as never, audit as never),
      prisma,
      audits,
      getStored: () => stored,
      setStored: (v: typeof stored) => {
        stored = v;
      },
    };
  }

  it('creates PLANNED activity and audits ACTIVITY_CREATE', async () => {
    const { service, audits } = build();
    const res = await service.create(actor, leadId, {
      type: LeadActivityType.CALL,
      title: 'Call lead',
    });
    expect(res.status).toBe(LeadActivityStatus.PLANNED);
    expect(audits[0]).toMatchObject({ action: 'ACTIVITY_CREATE' });
  });

  it('complete sets DONE + completedAt and audits ACTIVITY_COMPLETE', async () => {
    const { service, audits, getStored } = build();
    const res = await service.complete(actor, leadId, 'act-1');
    expect(res.status).toBe(LeadActivityStatus.DONE);
    expect(getStored().completedAt).toBeTruthy();
    expect(audits[0]).toMatchObject({ action: 'ACTIVITY_COMPLETE' });
  });

  it('cancel sets CANCELLED and audits ACTIVITY_CANCEL', async () => {
    const { service, audits } = build();
    const res = await service.cancel(actor, leadId, 'act-1');
    expect(res.status).toBe(LeadActivityStatus.CANCELLED);
    expect(audits[0]).toMatchObject({ action: 'ACTIVITY_CANCEL' });
  });

  it('rejects mutations on DONE activities', async () => {
    const { service } = build({ status: LeadActivityStatus.DONE });
    await expect(
      service.update(actor, leadId, 'act-1', { title: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.complete(actor, leadId, 'act-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid status transition PLANNED→PLANNED via update status same is ok path', async () => {
    const { service } = build();
    await expect(
      service.update(actor, leadId, 'act-1', {
        status: LeadActivityStatus.PLANNED,
      }),
    ).resolves.toBeTruthy();
  });
});
