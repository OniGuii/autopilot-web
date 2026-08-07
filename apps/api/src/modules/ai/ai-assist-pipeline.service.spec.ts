import { AiAgentMode, AiIntent, FollowUpStatus } from '@prisma/client';
import { AiAssistPipelineService } from './ai-assist-pipeline.service';
import { AiAutoGuardrailsService } from './ai-auto-guardrails.service';
import { AiIntentService } from './ai-intent.service';
import { KnowledgeBaseResolver } from './knowledge-base-resolver.service';
import {
  AI_AGENT_MESSAGE_SOURCE,
  AI_AUTO_SENT,
  AI_AUTO_SKIPPED,
  AI_ESCALATED,
  AI_FOLLOWUP_TYPE,
  AI_INTENT_CLASSIFIED,
  AI_KB_MATCH_FOUND,
  AI_KB_MATCH_MISSED,
  AI_RESPONSE_GENERATED,
} from './ai.constants';

describe('AiAssistPipelineService (11C)', () => {
  const companyId = 'c1';
  const conversationId = 'conv-1';
  const leadId = 'lead-1';
  const messageId = 'msg-1';

  const auditWrites: Array<{ action: string }> = [];
  const createdFollowUps: Array<Record<string, unknown>> = [];

  const audit = {
    write: jest.fn(async (_tx: unknown, data: { action: string }) => {
      auditWrites.push({ action: data.action });
      return { id: 'a1' };
    }),
  };

  const prisma = {
    companyAiSettings: { findFirst: jest.fn() },
    followUp: { findFirst: jest.fn(), create: jest.fn() },
    conversation: { findFirst: jest.fn(), update: jest.fn() },
    message: { findFirst: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };

  const intentService = {
    classify: jest.fn(),
    evaluateEscalation: jest.fn(),
    intentRequiresKb: jest.fn((intent: AiIntent) =>
      [
        AiIntent.PRICE,
        AiIntent.PRODUCT,
        AiIntent.PAYMENT,
        AiIntent.DELIVERY,
        AiIntent.HOURS,
        AiIntent.ADDRESS,
      ].includes(intent),
    ),
    isAutoSafeIntent: jest.fn((intent: AiIntent) =>
      [
        AiIntent.PRICE,
        AiIntent.PRODUCT,
        AiIntent.PAYMENT,
        AiIntent.DELIVERY,
        AiIntent.HOURS,
        AiIntent.ADDRESS,
      ].includes(intent),
    ),
  };

  const kbResolver = { resolve: jest.fn() };
  const guardrails = { evaluate: jest.fn() };
  const whatsappSend = { send: jest.fn() };
  const prom = {
    recordAiIntent: jest.fn(),
    recordAiKbHit: jest.fn(),
    recordAiKbMiss: jest.fn(),
    recordAiResponseGenerated: jest.fn(),
    recordAiResponseEscalated: jest.fn(),
    recordAiAutoSent: jest.fn(),
    recordAiAutoSkipped: jest.fn(),
  };

  let service: AiAssistPipelineService;

  beforeEach(() => {
    jest.clearAllMocks();
    auditWrites.length = 0;
    createdFollowUps.length = 0;

    prisma.companyAiSettings.findFirst.mockResolvedValue({
      mode: AiAgentMode.ASSIST,
      maxAutoRepliesPerLeadDay: 3,
    });
    prisma.followUp.findFirst.mockResolvedValue(null);
    prisma.message.findFirst.mockImplementation(
      async (args: { where?: { direction?: string; id?: string } }) => {
        if (args?.where?.direction === 'OUTBOUND') return null;
        if (args?.where?.id === messageId) {
          return { id: messageId, metadata: null };
        }
        return null;
      },
    );
    prisma.message.update.mockResolvedValue({});
    prisma.conversation.findFirst.mockResolvedValue({
      id: conversationId,
      assignedUserId: 'user-1',
      agentPaused: false,
      lead: { ownerId: 'owner-1' },
    });
    prisma.conversation.update.mockResolvedValue({});
    prisma.followUp.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `fu-${createdFollowUps.length + 1}`, ...data };
        createdFollowUps.push(row);
        return row;
      },
    );
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    guardrails.evaluate.mockResolvedValue({ allowed: true });

    service = new AiAssistPipelineService(
      prisma as never,
      audit as never,
      intentService as unknown as AiIntentService,
      kbResolver as unknown as KnowledgeBaseResolver,
      guardrails as unknown as AiAutoGuardrailsService,
      whatsappSend as never,
      prom as never,
    );
  });

  function stubClassify(intent: AiIntent, confidence = 0.88) {
    intentService.classify.mockResolvedValue({
      intent,
      confidence,
      escalated: false,
      escalationReason: null,
      kbMatched: false,
      matchedKinds: [],
      rationale: `heuristic:${intent}`,
    });
  }

  function stubKbHit() {
    kbResolver.resolve.mockResolvedValue({
      bestMatch: {
        id: 'kb-1',
        kind: 'PRICE',
        title: 'Plano Pro',
        body: 'R$ 199/mês',
        tags: ['preco'],
      },
      confidence: 0.7,
      source: 'kb:PRICE:kb-1',
    });
  }

  it('PRICE com KB (ASSIST) cria FollowUp SUGGESTED sem enviar', async () => {
    stubClassify(AiIntent.PRICE);
    stubKbHit();
    intentService.evaluateEscalation.mockReturnValue({
      escalated: false,
      escalationReason: null,
    });

    const result = await service.handleInbound({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'quanto custa o plano pro?',
    });

    expect(result.whatsappSent).toBe(false);
    expect(createdFollowUps[0].status).toBe(FollowUpStatus.SUGGESTED);
    expect(whatsappSend.send).not.toHaveBeenCalled();
    expect(auditWrites.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        AI_INTENT_CLASSIFIED,
        AI_KB_MATCH_FOUND,
        AI_RESPONSE_GENERATED,
      ]),
    );
  });

  it('PRICE sem KB escala com FollowUp requiresHuman', async () => {
    stubClassify(AiIntent.PRICE);
    kbResolver.resolve.mockResolvedValue({
      bestMatch: null,
      confidence: 0,
      source: null,
    });
    intentService.evaluateEscalation.mockReturnValue({
      escalated: true,
      escalationReason: 'PRICE_WITHOUT_KB',
    });

    const result = await service.handleInbound({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'quanto custa?',
    });

    expect(result.requiresHuman).toBe(true);
    expect(result.whatsappSent).toBe(false);
    expect(auditWrites.map((a) => a.action)).toContain(AI_KB_MATCH_MISSED);
    expect(auditWrites.map((a) => a.action)).toContain(AI_ESCALATED);
  });

  it('AUTO + PRICE com KB envia via WhatsappSendService', async () => {
    prisma.companyAiSettings.findFirst.mockResolvedValue({
      mode: AiAgentMode.AUTO,
      maxAutoRepliesPerLeadDay: 3,
    });
    stubClassify(AiIntent.PRICE);
    stubKbHit();
    intentService.evaluateEscalation.mockReturnValue({
      escalated: false,
      escalationReason: null,
    });
    whatsappSend.send.mockResolvedValue({
      ok: true,
      messageId: 'out-1',
      conversationId,
      leadId,
      externalMessageId: 'wa-1',
      status: 'SENT',
      correlationId: 'corr-1',
    });

    const result = await service.handleInbound({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'quanto custa o plano pro?',
    });

    expect(result.whatsappSent).toBe(true);
    expect(result.correlationId).toBe('corr-1');
    expect(whatsappSend.send).toHaveBeenCalledWith(
      expect.objectContaining({ cid: companyId }),
      expect.objectContaining({
        body: expect.stringContaining('Plano Pro'),
        metadata: expect.objectContaining({
          source: AI_AGENT_MESSAGE_SOURCE,
          autoSend: true,
        }),
      }),
    );
    expect(createdFollowUps[0].status).toBe(FollowUpStatus.EXECUTED);
    expect(auditWrites.map((a) => a.action)).toContain(AI_AUTO_SENT);
    expect(prom.recordAiAutoSent).toHaveBeenCalled();
  });

  it('AUTO nunca envia COMPLAINT / HUMAN / UNKNOWN', async () => {
    prisma.companyAiSettings.findFirst.mockResolvedValue({
      mode: AiAgentMode.AUTO,
      maxAutoRepliesPerLeadDay: 3,
    });

    for (const intent of [
      AiIntent.COMPLAINT,
      AiIntent.HUMAN,
      AiIntent.UNKNOWN,
    ]) {
      jest.clearAllMocks();
      createdFollowUps.length = 0;
      auditWrites.length = 0;
      prisma.companyAiSettings.findFirst.mockResolvedValue({
        mode: AiAgentMode.AUTO,
        maxAutoRepliesPerLeadDay: 3,
      });
      prisma.followUp.findFirst.mockResolvedValue(null);
      prisma.message.findFirst.mockImplementation(
        async (args: { where?: { direction?: string; id?: string } }) => {
          if (args?.where?.direction === 'OUTBOUND') return null;
          if (args?.where?.id === messageId) {
            return { id: messageId, metadata: null };
          }
          return null;
        },
      );
      prisma.conversation.findFirst.mockResolvedValue({
        id: conversationId,
        assignedUserId: 'user-1',
        agentPaused: false,
        lead: { ownerId: 'owner-1' },
      });
      prisma.$transaction.mockImplementation(
        async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
      );
      prisma.followUp.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `fu-${createdFollowUps.length + 1}`, ...data };
          createdFollowUps.push(row);
          return row;
        },
      );

      stubClassify(intent, 0.95);
      kbResolver.resolve.mockResolvedValue({
        bestMatch: null,
        confidence: 0,
        source: null,
      });
      intentService.evaluateEscalation.mockReturnValue({
        escalated: true,
        escalationReason: intent,
      });

      const result = await service.handleInbound({
        companyId,
        conversationId,
        leadId,
        messageId,
        messageBody: 'msg',
      });

      expect(result.whatsappSent).toBe(false);
      expect(result.requiresHuman).toBe(true);
      expect(whatsappSend.send).not.toHaveBeenCalled();
      expect(createdFollowUps[0].type).toBe(AI_FOLLOWUP_TYPE);
      expect(createdFollowUps[0].status).toBe(FollowUpStatus.SUGGESTED);
      expect(auditWrites.map((a) => a.action)).toContain(AI_ESCALATED);
    }
  });

  it('AUTO com guardrail bloqueado degrada para ASSIST e audita skip', async () => {
    prisma.companyAiSettings.findFirst.mockResolvedValue({
      mode: AiAgentMode.AUTO,
      maxAutoRepliesPerLeadDay: 3,
    });
    stubClassify(AiIntent.PRICE);
    stubKbHit();
    intentService.evaluateEscalation.mockReturnValue({
      escalated: false,
      escalationReason: null,
    });
    guardrails.evaluate.mockResolvedValue({
      allowed: false,
      reason: 'LEAD_COOLDOWN',
    });

    const result = await service.handleInbound({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'quanto custa?',
    });

    expect(result.whatsappSent).toBe(false);
    expect(whatsappSend.send).not.toHaveBeenCalled();
    expect(createdFollowUps[0].status).toBe(FollowUpStatus.SUGGESTED);
    expect(auditWrites.map((a) => a.action)).toContain(AI_AUTO_SKIPPED);
    expect(prom.recordAiAutoSkipped).toHaveBeenCalled();
  });

  it('modo OFF não processa', async () => {
    prisma.companyAiSettings.findFirst.mockResolvedValue({
      mode: AiAgentMode.OFF,
      maxAutoRepliesPerLeadDay: 3,
    });

    const result = await service.handleInbound({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'quanto custa?',
    });

    expect(result).toEqual(
      expect.objectContaining({
        skipped: true,
        reason: 'AGENT_MODE_OFF',
        whatsappSent: false,
      }),
    );
    expect(intentService.classify).not.toHaveBeenCalled();
  });
});
