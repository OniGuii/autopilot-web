import {
  AiIntent,
  ConversationStatus,
  FollowUpStatus,
  LeadStatus,
  WhatsAppConnectionStatus,
} from '@prisma/client';
import {
  AI_RECOVERY_CREATED,
  AI_RECOVERY_FOLLOWUP_TYPE,
  AI_RECOVERY_MESSAGE_SOURCE,
  AI_RECOVERY_STOPPED,
} from './ai.constants';
import { AiRecoveryService } from './ai-recovery.service';

describe('AiRecoveryService (11D)', () => {
  const prisma = {
    companyRecoverySettings: { findFirst: jest.fn() },
    companyAiSettings: { findFirst: jest.fn() },
    whatsAppInstance: { findFirst: jest.fn() },
    lead: { findMany: jest.fn(), findFirst: jest.fn() },
    followUp: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    conversation: { findFirst: jest.fn() },
    message: { findFirst: jest.fn() },
    company: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { write: jest.fn() };
  const settings = {
    getOrCreate: jest.fn(),
  };
  const messages = {
    generate: jest.fn(),
  };
  const redis = { incrWithExpire: jest.fn() };
  const prom = {
    recordAiRecoveryActiveDelta: jest.fn(),
    recordAiRecoverySent: jest.fn(),
    recordAiRecoveryStopped: jest.fn(),
    recordAiRecoveryConverted: jest.fn(),
  };

  let service: AiRecoveryService;

  const policy = {
    enabled: true,
    maxAttempts: 3,
    cooldownHours: 24,
    stopOnReply: true,
    stopOnHumanTakeover: true,
    cadenceHours: [24, 72, 168],
    allowedHoursStart: null as number | null,
    allowedHoursEnd: null as number | null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    redis.incrWithExpire.mockResolvedValue(1);
    messages.generate.mockResolvedValue({
      body: 'Recovery KB grounded',
      intent: AiIntent.PRICE,
      kbSource: 'kb:1',
      promptVersion: 'recovery-kb.v1',
    });
    prisma.company.findFirst.mockResolvedValue({
      timezone: 'America/Sao_Paulo',
    });
    service = new AiRecoveryService(
      prisma as never,
      audit as never,
      settings as never,
      messages as never,
      redis as never,
      prom as never,
    );
  });

  describe('isEligibleStatus', () => {
    it('allows CONTACTED and RESPONDED only', () => {
      expect(service.isEligibleStatus(LeadStatus.CONTACTED)).toBe(true);
      expect(service.isEligibleStatus(LeadStatus.RESPONDED)).toBe(true);
      expect(service.isEligibleStatus(LeadStatus.CONVERTED)).toBe(false);
      expect(service.isEligibleStatus(LeadStatus.LOST)).toBe(false);
      expect(service.isEligibleStatus(LeadStatus.NEW)).toBe(false);
    });
  });

  describe('tryScheduleLead', () => {
    const lead = {
      id: 'lead-1',
      name: 'Ana',
      status: LeadStatus.CONTACTED,
      lastInboundAt: null as Date | null,
      lastOutboundAt: new Date(Date.now() - 48 * 3600_000),
      ownerId: 'user-1',
    };

    beforeEach(() => {
      prisma.followUp.findFirst.mockResolvedValue(null);
      prisma.followUp.findMany.mockResolvedValue([]);
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        assignedUserId: 'user-1',
        agentPaused: false,
        status: ConversationStatus.OPEN,
      });
      prisma.message.findFirst.mockResolvedValue({
        metadata: { aiIntent: { intent: 'PRICE' } },
      });
      prisma.followUp.create.mockResolvedValue({
        id: 'fu-1',
        scheduledAt: new Date(),
      });
      audit.write.mockResolvedValue(undefined);
    });

    it('schedules AI_RECOVERY SCHEDULED with source=ai_recovery', async () => {
      const ok = await service.tryScheduleLead('c1', lead, policy);
      expect(ok).toBe(true);
      expect(prisma.followUp.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: AI_RECOVERY_FOLLOWUP_TYPE,
            status: FollowUpStatus.SCHEDULED,
            metadata: expect.objectContaining({
              source: AI_RECOVERY_MESSAGE_SOURCE,
              recoveryAttempt: 1,
            }),
          }),
        }),
      );
      expect(audit.write).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: AI_RECOVERY_CREATED }),
      );
      expect(prom.recordAiRecoveryActiveDelta).toHaveBeenCalledWith(1);
    });

    it('rejects CONVERTED / LOST', async () => {
      await expect(
        service.tryScheduleLead(
          'c1',
          { ...lead, status: LeadStatus.CONVERTED },
          policy,
        ),
      ).resolves.toBe(false);
      await expect(
        service.tryScheduleLead(
          'c1',
          { ...lead, status: LeadStatus.LOST },
          policy,
        ),
      ).resolves.toBe(false);
      expect(prisma.followUp.create).not.toHaveBeenCalled();
    });

    it('stops scheduling when client replied after outbound', async () => {
      const ok = await service.tryScheduleLead(
        'c1',
        {
          ...lead,
          lastInboundAt: new Date(),
          lastOutboundAt: new Date(Date.now() - 48 * 3600_000),
        },
        policy,
      );
      expect(ok).toBe(false);
    });

    it('respects maxAttempts', async () => {
      prisma.followUp.findMany.mockResolvedValue([
        { id: 'a', executedAt: new Date(Date.now() - 100 * 3600_000), metadata: {} },
        { id: 'b', executedAt: new Date(Date.now() - 80 * 3600_000), metadata: {} },
        { id: 'c', executedAt: new Date(Date.now() - 50 * 3600_000), metadata: {} },
      ]);
      await expect(
        service.tryScheduleLead('c1', lead, policy),
      ).resolves.toBe(false);
    });

    it('respects human takeover (agentPaused)', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        assignedUserId: 'user-1',
        agentPaused: true,
      });
      await expect(
        service.tryScheduleLead('c1', lead, policy),
      ).resolves.toBe(false);
    });

    it('does not create second pending for same lead', async () => {
      prisma.followUp.findFirst.mockResolvedValue({ id: 'pending' });
      await expect(
        service.tryScheduleLead('c1', lead, policy),
      ).resolves.toBe(false);
    });

    it('isolates by companyId on create', async () => {
      await service.tryScheduleLead('tenant-A', lead, policy);
      expect(prisma.followUp.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'tenant-A' }),
        }),
      );
    });
  });

  describe('prepareExecution / stop conditions', () => {
    it('cancels when client replied', async () => {
      prisma.followUp.findFirst.mockResolvedValue({
        id: 'fu-1',
        leadId: 'lead-1',
        conversationId: 'conv-1',
        metadata: {
          recoveryAttempt: 1,
          recoveryAnchorAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
        },
      });
      prisma.companyRecoverySettings.findFirst.mockResolvedValue(policy);
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        status: LeadStatus.CONTACTED,
        name: 'Ana',
        lastInboundAt: new Date(),
        lastOutboundAt: new Date(Date.now() - 48 * 3600_000),
      });
      prisma.followUp.findMany.mockResolvedValue([
        {
          id: 'fu-1',
          metadata: {},
          status: FollowUpStatus.SCHEDULED,
        },
      ]);
      prisma.followUp.update.mockResolvedValue({});

      const result = await service.prepareExecution({
        companyId: 'c1',
        followUpId: 'fu-1',
      });
      expect(result).toEqual({ ok: false, reason: 'REPLY' });
      expect(audit.write).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: AI_RECOVERY_STOPPED }),
      );
    });

    it('cancels on human takeover', async () => {
      prisma.followUp.findFirst.mockResolvedValue({
        id: 'fu-1',
        leadId: 'lead-1',
        conversationId: 'conv-1',
        metadata: {
          recoveryAttempt: 1,
          recoveryAnchorAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
          intent: AiIntent.PRODUCT,
        },
      });
      prisma.companyRecoverySettings.findFirst.mockResolvedValue(policy);
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        status: LeadStatus.RESPONDED,
        name: 'Ana',
        lastInboundAt: null,
        lastOutboundAt: new Date(Date.now() - 48 * 3600_000),
      });
      prisma.conversation.findFirst.mockResolvedValue({ agentPaused: true });
      prisma.followUp.findMany.mockResolvedValue([
        { id: 'fu-1', metadata: {}, status: FollowUpStatus.SCHEDULED },
      ]);
      prisma.followUp.update.mockResolvedValue({});

      const result = await service.prepareExecution({
        companyId: 'c1',
        followUpId: 'fu-1',
      });
      expect(result).toEqual({ ok: false, reason: 'HUMAN_TAKEOVER' });
    });

    it('regenerates body when eligible', async () => {
      prisma.followUp.findFirst.mockResolvedValue({
        id: 'fu-1',
        leadId: 'lead-1',
        conversationId: 'conv-1',
        metadata: {
          recoveryAttempt: 1,
          recoveryAnchorAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
          intent: AiIntent.PAYMENT,
        },
      });
      prisma.companyRecoverySettings.findFirst.mockResolvedValue(policy);
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        status: LeadStatus.CONTACTED,
        name: 'Ana',
        lastInboundAt: null,
        lastOutboundAt: new Date(Date.now() - 48 * 3600_000),
      });
      prisma.conversation.findFirst.mockResolvedValue({ agentPaused: false });
      prisma.followUp.update.mockResolvedValue({});

      const result = await service.prepareExecution({
        companyId: 'c1',
        followUpId: 'fu-1',
      });
      expect(result).toEqual({
        ok: true,
        suggestedBody: 'Recovery KB grounded',
      });
      expect(messages.generate).toHaveBeenCalled();
    });

    it('marks converted when lead becomes CONVERTED after recovery sent', async () => {
      prisma.followUp.findFirst
        .mockResolvedValueOnce({ id: 'executed-fu' }) // hadRecovery
        .mockResolvedValue(null);
      prisma.followUp.findMany.mockResolvedValue([
        { id: 'pending', metadata: {}, status: FollowUpStatus.SCHEDULED },
      ]);
      prisma.followUp.update.mockResolvedValue({});
      audit.write.mockResolvedValue(undefined);

      await service.stopOnLeadTerminal({
        companyId: 'c1',
        leadId: 'lead-1',
        status: LeadStatus.CONVERTED,
      });

      expect(prom.recordAiRecoveryConverted).toHaveBeenCalled();
      expect(audit.write).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'AI_RECOVERY_CONVERTED' }),
      );
    });
  });

  describe('scheduleEligibleForCompany', () => {
    it('returns 0 when recovery disabled or agent OFF', async () => {
      prisma.companyRecoverySettings.findFirst.mockResolvedValue({
        ...policy,
        enabled: false,
      });
      await expect(service.scheduleEligibleForCompany('c1')).resolves.toBe(0);

      prisma.companyRecoverySettings.findFirst.mockResolvedValue(policy);
      prisma.companyAiSettings.findFirst.mockResolvedValue({ mode: 'OFF' });
      await expect(service.scheduleEligibleForCompany('c1')).resolves.toBe(0);
    });

    it('returns 0 when WhatsApp not connected', async () => {
      prisma.companyRecoverySettings.findFirst.mockResolvedValue(policy);
      prisma.companyAiSettings.findFirst.mockResolvedValue({ mode: 'ASSIST' });
      prisma.whatsAppInstance.findFirst.mockResolvedValue({
        status: WhatsAppConnectionStatus.DISCONNECTED,
      });
      await expect(service.scheduleEligibleForCompany('c1')).resolves.toBe(0);
    });
  });
});
