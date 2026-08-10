import { LeadStatus } from '@prisma/client';
import { OutboundProtectionService } from './outbound-protection.service';

describe('OutboundProtectionService (V1.1)', () => {
  const prisma = {
    lead: { findFirst: jest.fn() },
    message: { count: jest.fn(), findFirst: jest.fn() },
    company: { findFirst: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({}),
    ),
  };
  const audit = { write: jest.fn() };
  const settings = {
    getOrCreate: jest.fn(),
  };
  const suppress = {
    isSuppressed: jest.fn(),
  };
  const prom = {
    recordOutboundProtectionAllowed: jest.fn(),
    recordOutboundProtectionBlocked: jest.fn(),
    setOutboundProactiveRemainingDaily: jest.fn(),
    setOutboundProactiveRemainingHourly: jest.fn(),
  };

  let service: OutboundProtectionService;

  const policy = {
    enabled: true,
    dailyProactiveCap: 50,
    hourlyProactiveCap: 15,
    leadCooldownMinutes: 60,
    minSpacingSeconds: 30,
    allowedHoursStart: null as number | null,
    allowedHoursEnd: null as number | null,
    suppressOnKeywords: ['pare'],
    autoSuppressOnLost: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    settings.getOrCreate.mockResolvedValue(policy);
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      phone: '5511999998888',
      status: LeadStatus.CONTACTED,
    });
    suppress.isSuppressed.mockResolvedValue(false);
    prisma.message.count.mockResolvedValue(0);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.company.findFirst.mockResolvedValue({
      timezone: 'America/Sao_Paulo',
    });
    service = new OutboundProtectionService(
      prisma as never,
      audit as never,
      settings as never,
      suppress as never,
      prom as never,
    );
  });

  const base = {
    companyId: 'c1',
    leadId: 'lead-1',
    source: 'ai_recovery',
    auditOnBlock: false,
  };

  it('skips gate for non-proactive sources', async () => {
    await expect(
      service.canSendProactive({ ...base, source: 'whatsapp_send' }),
    ).resolves.toEqual({
      allowed: true,
      remainingDaily: -1,
      remainingHourly: -1,
    });
  });

  it('allows proactive when protection enabled and under caps', async () => {
    await expect(service.canSendProactive(base)).resolves.toEqual({
      allowed: true,
      remainingDaily: 49,
      remainingHourly: 14,
    });
    expect(prom.recordOutboundProtectionAllowed).toHaveBeenCalled();
  });

  it('always blocks suppressed phones', async () => {
    suppress.isSuppressed.mockResolvedValue(true);
    await expect(service.canSendProactive(base)).resolves.toEqual(
      expect.objectContaining({ allowed: false, reason: 'SUPPRESSED' }),
    );
  });

  it('blocks LOST leads', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      phone: '5511999998888',
      status: LeadStatus.LOST,
    });
    await expect(service.canSendProactive(base)).resolves.toEqual(
      expect.objectContaining({ allowed: false, reason: 'LEAD_LOST' }),
    );
  });

  it('blocks when daily cap reached and enabled', async () => {
    prisma.message.count
      .mockResolvedValueOnce(50) // daily
      .mockResolvedValueOnce(0); // hourly
    await expect(service.canSendProactive(base)).resolves.toEqual(
      expect.objectContaining({ allowed: false, reason: 'DAILY_CAP' }),
    );
  });

  it('blocks when hourly cap reached and enabled', async () => {
    prisma.message.count.mockResolvedValueOnce(3).mockResolvedValueOnce(15);
    await expect(service.canSendProactive(base)).resolves.toEqual(
      expect.objectContaining({ allowed: false, reason: 'HOURLY_CAP' }),
    );
  });

  it('blocks lead cooldown', async () => {
    prisma.message.findFirst.mockResolvedValue({ id: 'm1' });
    await expect(service.canSendProactive(base)).resolves.toEqual(
      expect.objectContaining({ allowed: false, reason: 'LEAD_COOLDOWN' }),
    );
  });

  it('skips caps when protection disabled but still enforces suppress', async () => {
    settings.getOrCreate.mockResolvedValue({ ...policy, enabled: false });
    prisma.message.count.mockResolvedValue(999);
    await expect(service.canSendProactive(base)).resolves.toEqual({
      allowed: true,
      remainingDaily: 0,
      remainingHourly: 0,
    });

    suppress.isSuppressed.mockResolvedValue(true);
    await expect(service.canSendProactive(base)).resolves.toEqual(
      expect.objectContaining({ allowed: false, reason: 'SUPPRESSED' }),
    );
  });
});
