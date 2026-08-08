import { NotFoundException } from '@nestjs/common';
import { AiIntent } from '@prisma/client';
import {
  SALES_MEMORY_CLEARED,
  SALES_MEMORY_CREATED,
  SALES_MEMORY_UPDATED,
} from './ai.constants';
import { SalesMemoryExtractorService } from './sales-memory-extractor.service';
import { SalesMemoryService } from './sales-memory.service';

describe('SalesMemoryService (11E.1)', () => {
  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = { write: jest.fn() };
  const extractor = new SalesMemoryExtractorService();
  const prom = {
    recordSalesMemoryUpdate: jest.fn(),
    recordSalesMemoryFieldDetected: jest.fn(),
    recordSalesMemoryConflicts: jest.fn(),
  };

  let service: SalesMemoryService;
  let storedMeta: Record<string, unknown> | null;

  beforeEach(() => {
    jest.clearAllMocks();
    storedMeta = null;
    prisma.conversation.findFirst.mockImplementation(async () => ({
      id: 'conv-1',
      metadata: storedMeta,
    }));
    prisma.conversation.update.mockImplementation(
      async ({ data }: { data: { metadata: Record<string, unknown> } }) => {
        storedMeta = data.metadata;
        return { id: 'conv-1', metadata: storedMeta };
      },
    );
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    audit.write.mockResolvedValue({});
    service = new SalesMemoryService(
      prisma as never,
      audit as never,
      extractor,
      prom as never,
    );
  });

  it('loadMemory returns empty when no metadata', async () => {
    const mem = await service.loadMemory('c1', 'conv-1');
    expect(mem.version).toBe(0);
    expect(mem.budget).toBeNull();
    expect(mem.purchaseIntentLevel).toBe('NONE');
  });

  it('persists memory across update (survives "restart")', async () => {
    await service.updateFromInbound({
      companyId: 'c1',
      conversationId: 'conv-1',
      messageId: 'm1',
      messageBody: 'Moro em Campinas, orçamento R$ 400',
      intent: AiIntent.PRICE,
    });

    // Simulate new service instance reading same store
    const again = new SalesMemoryService(
      prisma as never,
      audit as never,
      extractor,
      prom as never,
    );
    const loaded = await again.loadMemory('c1', 'conv-1');
    expect(loaded.version).toBeGreaterThan(0);
    expect(loaded.city?.toLowerCase()).toContain('campinas');
    expect(loaded.budget).toMatch(/400/);
    expect(audit.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: SALES_MEMORY_CREATED }),
    );
  });

  it('merge keeps previous slots and records conflicts on change', () => {
    const current = service.emptyMemory();
    current.version = 1;
    current.budget = 'R$ 300';
    current.city = 'Campinas';
    current.updatedAt = new Date().toISOString();

    const merged = service.mergeMemory(current, {
      budget: 'R$ 500',
      paymentPreference: 'Pix',
    });

    expect(merged.conflicts).toContain('budget');
    expect(merged.memory.budget).toBe('R$ 500');
    expect(merged.memory.city).toBe('Campinas');
    expect(merged.memory.paymentPreference).toBe('Pix');
    expect(merged.memory.version).toBe(2);
  });

  it('null / empty patch does not wipe slots', () => {
    const current = {
      ...service.emptyMemory(),
      version: 2,
      budget: 'R$ 200',
      city: 'Santos',
      updatedAt: new Date().toISOString(),
    };
    const merged = service.mergeMemory(current, {});
    expect(merged.changed).toBe(false);
    expect(merged.memory.budget).toBe('R$ 200');
  });

  it('does not downgrade purchaseIntentLevel', () => {
    const current = {
      ...service.emptyMemory(),
      version: 1,
      purchaseIntentLevel: 'HIGH' as const,
      updatedAt: new Date().toISOString(),
    };
    const merged = service.mergeMemory(current, {
      purchaseIntentLevel: 'LOW',
    });
    expect(merged.memory.purchaseIntentLevel).toBe('HIGH');
  });

  it('clearMemory resets slots and audits', async () => {
    storedMeta = {
      salesMemory: {
        ...service.emptyMemory(),
        version: 3,
        budget: 'R$ 100',
        city: 'SP',
        updatedAt: new Date().toISOString(),
      },
    };
    const cleared = await service.clearMemory({
      companyId: 'c1',
      conversationId: 'conv-1',
      actorUserId: 'u1',
    });
    expect(cleared.budget).toBeNull();
    expect(cleared.version).toBe(4);
    expect(audit.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: SALES_MEMORY_CLEARED }),
    );
  });

  it('isolates by companyId (not found other tenant)', async () => {
    prisma.conversation.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.loadMemory('other-tenant', 'conv-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateMemory audits SALES_MEMORY_UPDATED on second write', async () => {
    await service.updateMemory({
      companyId: 'c1',
      conversationId: 'conv-1',
      patch: { city: 'Recife' },
      messageId: 'm1',
    });
    await service.updateMemory({
      companyId: 'c1',
      conversationId: 'conv-1',
      patch: { paymentPreference: 'Pix' },
      messageId: 'm2',
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: SALES_MEMORY_UPDATED }),
    );
    const mem = await service.loadMemory('c1', 'conv-1');
    expect(mem.city).toBe('Recife');
    expect(mem.paymentPreference).toBe('Pix');
  });

  it('formatForPrompt includes memory for recovery context', async () => {
    await service.updateMemory({
      companyId: 'c1',
      conversationId: 'conv-1',
      patch: {
        city: 'Curitiba',
        productInterest: ['Plano Pro'],
        lastObjection: 'PRICE',
      },
    });
    const mem = await service.loadMemory('c1', 'conv-1');
    const text = service.formatForPrompt(mem);
    expect(text).toMatch(/Curitiba/);
    expect(text).toMatch(/Plano Pro/);
    expect(text).toMatch(/PRICE/);
  });
});
