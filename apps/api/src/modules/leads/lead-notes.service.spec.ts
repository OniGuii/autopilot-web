import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { LeadNotesService } from './lead-notes.service';

describe('LeadNotesService', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const leadId = '22222222-2222-2222-2222-222222222222';
  const authorId = '33333333-3333-3333-3333-333333333333';
  const otherAgent = '44444444-4444-4444-4444-444444444444';

  const baseNote = {
    id: 'note-1',
    companyId,
    leadId,
    userId: authorId,
    body: 'Hello note',
    createdAt: new Date('2026-08-01T10:00:00Z'),
    updatedAt: new Date('2026-08-01T10:00:00Z'),
    deletedAt: null,
  };

  function build(role: MembershipRole = MembershipRole.AGENT, sub = authorId) {
    const audits: unknown[] = [];
    let stored = { ...baseNote };

    const prisma = {
      lead: {
        findFirst: jest.fn().mockResolvedValue({ id: leadId }),
      },
      leadNote: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          stored = {
            ...stored,
            ...data,
            id: 'note-1',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          return { ...stored };
        }),
        findMany: jest.fn().mockResolvedValue([stored]),
        findFirst: jest.fn().mockImplementation(async ({ where }) => {
          if (where.id && where.id !== stored.id) return null;
          if (stored.deletedAt) return null;
          return { ...stored };
        }),
        update: jest.fn().mockImplementation(async ({ data }) => {
          stored = { ...stored, ...data, updatedAt: new Date() };
          return { ...stored };
        }),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          leadNote: prisma.leadNote,
          auditLog: {},
        }),
      ),
    };

    const audit = {
      write: jest.fn(async (_tx: unknown, input: unknown) => {
        audits.push(input);
        return { id: 'a1' };
      }),
    };

    const service = new LeadNotesService(prisma as never, audit as never);
    const actor = {
      sub,
      cid: companyId,
      mid: 'mem-1',
      role,
    } as never;

    return { service, prisma, audit, audits, actor, getStored: () => stored };
  }

  it('creates note with userId=actor.sub and audits NOTE_CREATE', async () => {
    const { service, actor, audits, prisma } = build();
    const res = await service.create(actor, leadId, { body: 'New note' });
    expect(prisma.leadNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: authorId,
          body: 'New note',
          leadId,
          companyId,
        }),
      }),
    );
    expect(res.body).toBe('New note');
    expect(audits[0]).toMatchObject({ action: 'NOTE_CREATE' });
  });

  it('allows author to update; forbids other AGENT', async () => {
    const author = build(MembershipRole.AGENT, authorId);
    await author.service.update(author.actor, leadId, 'note-1', {
      body: 'Updated',
    });
    expect(author.audits[0]).toMatchObject({ action: 'NOTE_UPDATE' });

    const other = build(MembershipRole.AGENT, otherAgent);
    await expect(
      other.service.update(other.actor, leadId, 'note-1', { body: 'Nope' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows OWNER to delete note of another user with NOTE_DELETE', async () => {
    const { service, actor, audits } = build(MembershipRole.OWNER, otherAgent);
    await service.remove(actor, leadId, 'note-1');
    expect(audits[0]).toMatchObject({ action: 'NOTE_DELETE' });
  });

  it('404 when lead missing', async () => {
    const { service, actor, prisma } = build();
    prisma.lead.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.create(actor, leadId, { body: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
