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
