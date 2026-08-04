import { LeadStatus } from '@prisma/client';
import { LeadsService } from './leads.service';

describe('LeadsService CRM operations', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const actor = {
    sub: 'user-owner',
    cid: companyId,
    mid: 'mem-1',
    role: 'OWNER',
  } as never;

  const baseLead = {
    id: 'lead-1',
    companyId,
    ownerId: 'user-agent',
    name: 'Maria',
    phone: '5511999990001',
    email: null,
    source: 'WHATSAPP',
    status: LeadStatus.NEW,
    score: 0,
    lastContactAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    convertedAt: null,
    firstResponseAt: null,
    externalId: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  function build() {
    const audits: unknown[] = [];
    const transitions: unknown[] = [];
    let stored = { ...baseLead };

    const prisma = {
      lead: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          stored = {
            ...stored,
            id: 'lead-1',
            companyId,
            name: data.name,
            phone: data.phone,
            email: data.email ?? null,
            source: data.source ?? 'WHATSAPP',
            status: data.status ?? LeadStatus.NEW,
            score: data.score ?? 0,
            ownerId: data.owner?.connect?.id ?? null,
            convertedAt: data.convertedAt ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          return { ...stored };
        }),
        findFirst: jest.fn().mockImplementation(async () =>
          stored.deletedAt ? null : { ...stored },
        ),
        findMany: jest.fn().mockImplementation(async ({ where }) => {
          if (where?.id?.in) {
            return where.id.in.includes(stored.id) ? [{ ...stored }] : [];
          }
          return [{ ...stored }];
        }),
        update: jest.fn().mockImplementation(async ({ data }) => {
          const next = { ...stored };
          if (data.owner?.disconnect) next.ownerId = null;
          if (data.owner?.connect?.id) next.ownerId = data.owner.connect.id;
          if (data.status !== undefined) next.status = data.status;
          if (data.convertedAt !== undefined) next.convertedAt = data.convertedAt;
          if (data.deletedAt !== undefined) next.deletedAt = data.deletedAt;
          if (data.name !== undefined) next.name = data.name;
          stored = { ...next, updatedAt: new Date() };
          return { ...stored };
        }),
        count: jest.fn().mockResolvedValue(1),
      },
      leadStatusTransition: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          transitions.push(data);
          return { id: 'tr-1', ...data };
        }),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue({ id: 'mem-1' }),
      },
      $transaction: jest.fn(async (fn: unknown) => {
        if (typeof fn === 'function') {
          return fn({
            lead: prisma.lead,
            leadStatusTransition: prisma.leadStatusTransition,
            auditLog: {},
          });
        }
        return fn;
      }),
    };

    const audit = {
      write: jest.fn(async (_tx: unknown, input: unknown) => {
        audits.push(input);
        return { id: 'a' };
      }),
    };

    return {
      service: new LeadsService(prisma as never, audit as never),
      prisma,
      audits,
      transitions,
      getStored: () => stored,
      setStored: (v: typeof stored) => {
        stored = v;
      },
    };
  }

  it('writes LeadStatusTransition on create (fromStatus null → status)', async () => {
    const { service, transitions, audits } = build();
    await service.create(actor, {
      name: 'Maria',
      phone: '+55 11 99999-0001',
      status: LeadStatus.CONTACTED,
    });
    expect(transitions[0]).toMatchObject({
      fromStatus: null,
      toStatus: LeadStatus.CONTACTED,
      changedByUserId: 'user-owner',
    });
    expect(audits.map((a) => (a as { action: string }).action)).toContain(
      'LEAD_CREATE',
    );
  });

  it('writes transition + LEAD_STATUS_CHANGE on status update', async () => {
    const { service, transitions, audits } = build();
    await service.update(actor, 'lead-1', { status: LeadStatus.QUALIFIED });
    expect(transitions[0]).toMatchObject({
      fromStatus: LeadStatus.NEW,
      toStatus: LeadStatus.QUALIFIED,
    });
    expect(audits.map((a) => (a as { action: string }).action)).toEqual(
      expect.arrayContaining(['LEAD_UPDATE', 'LEAD_STATUS_CHANGE']),
    );
  });

  it('unassign clears ownerId and audits LEAD_UNASSIGN', async () => {
    const { service, audits, getStored } = build();
    const res = await service.unassign(actor, 'lead-1');
    expect(res.ownerId).toBeNull();
    expect(getStored().ownerId).toBeNull();
    expect(audits[0]).toMatchObject({ action: 'LEAD_UNASSIGN' });
  });

  it('bulkAssign updates matching leads and writes per-lead + summary audits', async () => {
    const { service, audits } = build();
    const res = await service.bulkAssign(actor, {
      ownerId: 'user-agent',
      leadIds: ['lead-1', 'missing-lead'],
    });
    expect(res).toMatchObject({
      ownerId: 'user-agent',
      requested: 2,
      updated: 1,
      ignored: 1,
      ignoredIds: ['missing-lead'],
    });
    const actions = audits.map((a) => (a as { action: string }).action);
    expect(actions).toContain('LEAD_ASSIGN');
    expect(actions).toContain('LEAD_BULK_ASSIGN');
  });

  it('bulkAssign with ownerId null mass-unassigns', async () => {
    const { service, audits, getStored } = build();
    const res = await service.bulkAssign(actor, {
      ownerId: null,
      leadIds: ['lead-1'],
    });
    expect(res.ownerId).toBeNull();
    expect(getStored().ownerId).toBeNull();
    expect(audits.map((a) => (a as { action: string }).action)).toEqual(
      expect.arrayContaining(['LEAD_UNASSIGN', 'LEAD_BULK_ASSIGN']),
    );
  });
});
