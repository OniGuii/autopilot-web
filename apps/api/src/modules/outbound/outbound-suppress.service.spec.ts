import { OutboundSuppressService } from './outbound-suppress.service';

describe('OutboundSuppressService (V1.1)', () => {
  const prisma = {
    outboundSuppressEntry: {
      findFirst: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    lead: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { write: jest.fn() };
  const settings = {
    getOrCreate: jest.fn().mockResolvedValue({
      suppressOnKeywords: ['pare', 'stop', 'sair'],
      autoSuppressOnLost: true,
    }),
  };
  const prom = {
    recordOutboundSuppressAdded: jest.fn(),
    recordOutboundSuppressRemoved: jest.fn(),
    recordOutboundOptOut: jest.fn(),
  };

  let service: OutboundSuppressService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    prisma.outboundSuppressEntry.upsert.mockResolvedValue({
      id: 's1',
      companyId: 'c1',
      phone: '5511999998888',
      leadId: 'lead-1',
      reason: 'Opt-out keyword: pare',
      source: 'KEYWORD',
      active: true,
      createdAt: new Date('2026-08-10T00:00:00Z'),
      updatedAt: new Date('2026-08-10T00:00:00Z'),
    });
    prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
    service = new OutboundSuppressService(
      prisma as never,
      audit as never,
      settings as never,
      prom as never,
    );
  });

  it('detects keyword opt-out and upserts suppress', async () => {
    const ok = await service.maybeOptOutFromInbound({
      companyId: 'c1',
      leadId: 'lead-1',
      phone: '5511999998888',
      body: 'Por favor pare de me enviar mensagens',
    });
    expect(ok).toBe(true);
    expect(prisma.outboundSuppressEntry.upsert).toHaveBeenCalled();
    expect(prom.recordOutboundOptOut).toHaveBeenCalled();
  });

  it('ignores inbound without opt-out keywords', async () => {
    const ok = await service.maybeOptOutFromInbound({
      companyId: 'c1',
      leadId: 'lead-1',
      phone: '5511999998888',
      body: 'Quero saber mais sobre o produto',
    });
    expect(ok).toBe(false);
    expect(prisma.outboundSuppressEntry.upsert).not.toHaveBeenCalled();
  });

  it('isSuppressed returns true for active entry', async () => {
    prisma.outboundSuppressEntry.findFirst.mockResolvedValue({ id: 's1' });
    await expect(service.isSuppressed('c1', '55 11 99999-8888')).resolves.toBe(
      true,
    );
  });
});
