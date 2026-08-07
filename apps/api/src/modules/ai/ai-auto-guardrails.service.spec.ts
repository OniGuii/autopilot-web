import { WhatsAppConnectionStatus } from '@prisma/client';
import { AiAutoGuardrailsService } from './ai-auto-guardrails.service';
import { AI_AUTO_MIN_CONFIDENCE } from './ai.constants';

describe('AiAutoGuardrailsService (11C)', () => {
  const prisma = {
    whatsAppInstance: { findFirst: jest.fn() },
    message: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  };
  const redis = { incrWithExpire: jest.fn() };

  let service: AiAutoGuardrailsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.whatsAppInstance.findFirst.mockResolvedValue({
      status: WhatsAppConnectionStatus.CONNECTED,
    });
    prisma.message.count.mockResolvedValue(0);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.message.findMany.mockResolvedValue([]);
    redis.incrWithExpire.mockResolvedValue(1);
    service = new AiAutoGuardrailsService(prisma as never, redis as never);
  });

  const base = {
    companyId: 'c1',
    conversationId: 'conv-1',
    leadId: 'lead-1',
    confidence: 0.9,
    maxAutoRepliesPerLeadDay: 3,
    agentPaused: false,
  };

  it('allows when all guardrails pass', async () => {
    await expect(service.evaluate(base)).resolves.toEqual({ allowed: true });
  });

  it('blocks when agent paused', async () => {
    await expect(
      service.evaluate({ ...base, agentPaused: true }),
    ).resolves.toEqual({ allowed: false, reason: 'AGENT_PAUSED' });
  });

  it('blocks low confidence', async () => {
    await expect(
      service.evaluate({
        ...base,
        confidence: AI_AUTO_MIN_CONFIDENCE - 0.01,
      }),
    ).resolves.toEqual({ allowed: false, reason: 'LOW_CONFIDENCE' });
  });

  it('blocks when WhatsApp not connected', async () => {
    prisma.whatsAppInstance.findFirst.mockResolvedValue({
      status: WhatsAppConnectionStatus.DISCONNECTED,
    });
    await expect(service.evaluate(base)).resolves.toEqual({
      allowed: false,
      reason: 'WHATSAPP_NOT_CONNECTED',
    });
  });

  it('blocks conversation auto limit', async () => {
    prisma.message.count
      .mockResolvedValueOnce(99) // conversation
      .mockResolvedValueOnce(0);
    await expect(service.evaluate(base)).resolves.toEqual({
      allowed: false,
      reason: 'CONVERSATION_AUTO_LIMIT',
    });
  });

  it('blocks lead cooldown', async () => {
    prisma.message.findFirst.mockResolvedValue({ id: 'm1' });
    await expect(service.evaluate(base)).resolves.toEqual({
      allowed: false,
      reason: 'LEAD_COOLDOWN',
    });
  });

  it('blocks anti-loop consecutive AI outbounds', async () => {
    prisma.message.findMany.mockResolvedValue([
      { direction: 'OUTBOUND', metadata: { source: 'ai_agent' } },
      { direction: 'OUTBOUND', metadata: { source: 'ai_agent' } },
    ]);
    await expect(service.evaluate(base)).resolves.toEqual({
      allowed: false,
      reason: 'ANTI_LOOP',
    });
  });

  it('blocks company rate limit', async () => {
    redis.incrWithExpire.mockResolvedValue(999);
    await expect(service.evaluate(base)).resolves.toEqual({
      allowed: false,
      reason: 'COMPANY_RATE_LIMIT',
    });
  });
});
