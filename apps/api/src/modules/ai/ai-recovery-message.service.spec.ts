import { AiIntent, MessageDirection } from '@prisma/client';
import { AiRecoveryMessageService } from './ai-recovery-message.service';

describe('AiRecoveryMessageService (11D)', () => {
  const prisma = {
    message: { findMany: jest.fn() },
  };
  const kbResolver = {
    resolve: jest.fn(),
  };
  let service: AiRecoveryMessageService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.message.findMany.mockResolvedValue([
      {
        direction: MessageDirection.INBOUND,
        body: 'Quanto custa o plano?',
      },
    ]);
    kbResolver.resolve.mockResolvedValue({
      bestMatch: {
        title: 'Preço Starter',
        body: 'R$ 99/mês',
        kind: 'PRICE',
      },
      source: 'kb:price',
    });
    service = new AiRecoveryMessageService(
      prisma as never,
      kbResolver as never,
    );
  });

  it('composes PRICE reminder from KB + context (not a fixed blast)', async () => {
    const a = await service.generate({
      companyId: 'c1',
      leadId: 'l1',
      conversationId: 'conv1',
      attempt: 1,
      intent: AiIntent.PRICE,
      leadName: 'Ana',
    });
    const b = await service.generate({
      companyId: 'c1',
      leadId: 'l1',
      conversationId: 'conv1',
      attempt: 1,
      intent: AiIntent.PRODUCT,
      leadName: 'Ana',
    });
    expect(a.body).toContain('Preço Starter');
    expect(a.body).toContain('valores');
    expect(a.body).not.toEqual(b.body);
    expect(a.kbSource).toBe('kb:price');
  });

  it('uses PAYMENT angle for closing facilitation', async () => {
    const out = await service.generate({
      companyId: 'c1',
      leadId: 'l1',
      conversationId: 'conv1',
      attempt: 2,
      intent: AiIntent.PAYMENT,
      leadName: null,
    });
    expect(out.body).toMatch(/pagamento|fechamento/i);
  });
});

describe('AiRecoveryMessageService + Sales Memory (11E.1)', () => {
  const prisma = {
    message: { findMany: jest.fn() },
  };
  const kbResolver = {
    resolve: jest.fn(),
  };
  const salesMemory = {
    loadMemory: jest.fn(),
    formatForPrompt: jest.fn(),
  };

  let service: AiRecoveryMessageService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.message.findMany.mockResolvedValue([
      {
        direction: MessageDirection.INBOUND,
        body: 'oi',
      },
    ]);
    kbResolver.resolve.mockResolvedValue({
      bestMatch: { title: 'Preço', body: 'R$ 99', kind: 'PRICE' },
      source: 'kb',
    });
    salesMemory.loadMemory.mockResolvedValue({
      version: 2,
      budget: 'R$ 400',
      productInterest: ['Plano Pro'],
      city: 'Campinas',
      urgency: 'HIGH',
      paymentPreference: 'Pix',
      deliveryPreference: null,
      lastObjection: null,
      purchaseIntentLevel: 'LOW',
      updatedAt: new Date().toISOString(),
      sourceMessageIds: [],
    });
    salesMemory.formatForPrompt.mockReturnValue(
      'interesse: Plano Pro · orçamento: R$ 400 · cidade: Campinas',
    );
    service = new AiRecoveryMessageService(
      prisma as never,
      kbResolver as never,
      salesMemory as never,
    );
  });

  it('includes sales memory summary (does not restart cold)', async () => {
    const out = await service.generate({
      companyId: 'c1',
      leadId: 'l1',
      conversationId: 'conv1',
      attempt: 1,
      intent: AiIntent.PRICE,
      leadName: 'Ana',
    });
    expect(salesMemory.loadMemory).toHaveBeenCalledWith('c1', 'conv1');
    expect(out.body).toMatch(/Plano Pro|Campinas|R\$ 400/);
    expect(out.body).toMatch(/já combinamos|Retomando/i);
  });
});
