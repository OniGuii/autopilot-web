import { NotFoundException } from '@nestjs/common';
import { KnowledgeBaseKind } from '@prisma/client';
import { KnowledgeBaseService } from './knowledge-base.service';

describe('KnowledgeBaseService (11A)', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const actor = { cid: companyId, sub: 'user-1' };

  const audit = { write: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const entry = {
    id: 'kb-1',
    companyId,
    kind: KnowledgeBaseKind.FAQ,
    title: 'Pix',
    body: 'Aceitamos Pix',
    tags: ['pagamento'],
    active: true,
    sortOrder: 0,
    createdAt: new Date('2026-08-07T00:00:00.000Z'),
    updatedAt: new Date('2026-08-07T00:00:00.000Z'),
  };

  let prisma: {
    knowledgeBaseEntry: {
      count: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: KnowledgeBaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      knowledgeBaseEntry: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)({
          knowledgeBaseEntry: prisma.knowledgeBaseEntry,
          auditLog: { create: jest.fn() },
        });
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
    service = new KnowledgeBaseService(prisma as never, audit as never);
  });

  it('lists entries for tenant', async () => {
    prisma.knowledgeBaseEntry.count.mockResolvedValue(1);
    prisma.knowledgeBaseEntry.findMany.mockResolvedValue([entry]);
    const result = await service.list(actor, { page: 1, pageSize: 50 });
    expect(result.total).toBe(1);
    expect(result.items[0].title).toBe('Pix');
    expect(prisma.knowledgeBaseEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId, deletedAt: null }),
      }),
    );
  });

  it('creates entry with audit', async () => {
    prisma.knowledgeBaseEntry.create.mockResolvedValue(entry);
    const created = await service.create(actor, {
      kind: KnowledgeBaseKind.FAQ,
      title: 'Pix',
      body: 'Aceitamos Pix',
    });
    expect(created.id).toBe('kb-1');
    expect(audit.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'AI_KB_CREATED', companyId }),
    );
  });

  it('soft deletes entry', async () => {
    prisma.knowledgeBaseEntry.findFirst.mockResolvedValue(entry);
    prisma.knowledgeBaseEntry.update.mockResolvedValue({
      ...entry,
      deletedAt: new Date(),
    });
    const result = await service.softDelete(actor, entry.id);
    expect(result).toEqual({ id: entry.id, deleted: true });
    expect(audit.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'AI_KB_DELETED' }),
    );
  });

  it('throws when entry missing', async () => {
    prisma.knowledgeBaseEntry.findFirst.mockResolvedValue(null);
    await expect(service.get(actor, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists active kinds for classifier', async () => {
    prisma.knowledgeBaseEntry.findMany.mockResolvedValue([
      { kind: KnowledgeBaseKind.PRICE },
      { kind: KnowledgeBaseKind.HOURS },
    ]);
    const kinds = await service.listActiveKinds(companyId);
    expect(kinds.has(KnowledgeBaseKind.PRICE)).toBe(true);
    expect(kinds.has(KnowledgeBaseKind.PRODUCT)).toBe(false);
  });
});
