import { AiAgentMode, AiIntent, FollowUpStatus } from '@prisma/client';
import { AiAssistPipelineService } from './ai-assist-pipeline.service';
import { AiIntentService } from './ai-intent.service';
import { KnowledgeBaseResolver } from './knowledge-base-resolver.service';
import {
  AI_ESCALATED,
  AI_FOLLOWUP_TYPE,
  AI_INTENT_CLASSIFIED,
  AI_KB_MATCH_FOUND,
  AI_KB_MATCH_MISSED,
  AI_RESPONSE_GENERATED,
} from './ai.constants';

describe('AiAssistPipelineService (11B)', () => {
  const companyId = 'c1';
  const conversationId = 'conv-1';
  const leadId = 'lead-1';
  const messageId = 'msg-1';

  const auditWrites: Array<{ action: string }> = [];

  const audit = {
    write: jest.fn(async (_tx: unknown, data: { action: string }) => {
      auditWrites.push({ action: data.action });
      return { id: 'a1' };
    }),
  };

  const createdFollowUps: Array<Record<string, unknown>> = [];

  const prisma = {
    companyAiSettings: {
      findFirst: jest.fn(),
    },
    followUp: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
    },
    message: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
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
      ].includes(intent),
    ),
  };

  const kbResolver = {
    resolve: jest.fn(),
  };

  const prom = {
    recordAiIntent: jest.fn(),
    recordAiKbHit: jest.fn(),
    recordAiKbMiss: jest.fn(),
    recordAiResponseGenerated: jest.fn(),
    recordAiResponseEscalated: jest.fn(),
  };

  let service: AiAssistPipelineService;
  let whatsappSendSpy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    auditWrites.length = 0;
    createdFollowUps.length = 0;
    whatsappSendSpy = jest.fn();

    prisma.companyAiSettings.findFirst.mockResolvedValue({
      mode: AiAgentMode.ASSIST,
    });
    prisma.followUp.findFirst.mockResolvedValue(null);
    prisma.conversation.findFirst.mockResolvedValue({
      id: conversationId,
      assignedUserId: 'user-1',
      lead: { ownerId: 'owner-1' },
    });
    prisma.message.findFirst.mockResolvedValue({
      id: messageId,
      metadata: null,
    });
    prisma.message.update.mockResolvedValue({});
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

    service = new AiAssistPipelineService(
      prisma as never,
      audit as never,
      intentService as unknown as AiIntentService,
      kbResolver as unknown as KnowledgeBaseResolver,
      prom as never,
    );
  });

  function stubClassify(
    intent: AiIntent,
    opts?: { confidence?: number; rationale?: string },
  ) {
    intentService.classify.mockResolvedValue({
      intent,
      confidence: opts?.confidence ?? 0.88,
      escalated: false,
      escalationReason: null,
      kbMatched: false,
      matchedKinds: [],
      rationale: opts?.rationale ?? `heuristic:${intent}`,
    });
  }

  it('PRICE com KB cria FollowUp SUGGESTED sem enviar WhatsApp', async () => {
    stubClassify(AiIntent.PRICE);
    kbResolver.resolve.mockResolvedValue({
      bestMatch: {
        id: 'kb-price',
        kind: 'PRICE',
        title: 'Plano Pro',
        body: 'R$ 199/mês',
        tags: ['preco'],
      },
      confidence: 0.7,
      source: 'kb:PRICE:kb-price',
    });
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

    expect(result.skipped).toBe(false);
    expect(result.whatsappSent).toBe(false);
    expect(result.requiresHuman).toBe(false);
    expect(result.intent).toBe(AiIntent.PRICE);
    expect(createdFollowUps).toHaveLength(1);
    expect(createdFollowUps[0]).toEqual(
      expect.objectContaining({
        type: AI_FOLLOWUP_TYPE,
        status: FollowUpStatus.SUGGESTED,
        assignedUserId: 'user-1',
      }),
    );
    expect(
      (createdFollowUps[0].metadata as { autoSend: boolean }).autoSend,
    ).toBe(false);
    expect(auditWrites.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        AI_INTENT_CLASSIFIED,
        AI_KB_MATCH_FOUND,
        AI_RESPONSE_GENERATED,
      ]),
    );
    expect(auditWrites.map((a) => a.action)).not.toContain(AI_ESCALATED);
    expect(prom.recordAiKbHit).toHaveBeenCalled();
    expect(prom.recordAiResponseGenerated).toHaveBeenCalled();
    expect(whatsappSendSpy).not.toHaveBeenCalled();
  });

  it('PRICE sem KB escala e cria FollowUp com requiresHuman', async () => {
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
    expect(createdFollowUps[0].metadata).toEqual(
      expect.objectContaining({
        requiresHuman: true,
        escalationReason: 'PRICE_WITHOUT_KB',
        autoSend: false,
      }),
    );
    expect(auditWrites.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        AI_INTENT_CLASSIFIED,
        AI_KB_MATCH_MISSED,
        AI_RESPONSE_GENERATED,
        AI_ESCALATED,
      ]),
    );
    expect(prom.recordAiKbMiss).toHaveBeenCalled();
    expect(prom.recordAiResponseEscalated).toHaveBeenCalled();
  });

  it('PRODUCT com KB gera sugestão ancorada', async () => {
    stubClassify(AiIntent.PRODUCT);
    kbResolver.resolve.mockResolvedValue({
      bestMatch: {
        id: 'kb-prod',
        kind: 'PRODUCT',
        title: 'Modelo X',
        body: 'Disponível em estoque, cor preta',
        tags: ['modelo'],
      },
      confidence: 0.65,
      source: 'kb:PRODUCT:kb-prod',
    });
    intentService.evaluateEscalation.mockReturnValue({
      escalated: false,
      escalationReason: null,
    });

    const result = await service.handleInbound({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'vocês têm o modelo x em estoque?',
    });

    expect(result.requiresHuman).toBe(false);
    expect(String(createdFollowUps[0].suggestedBody)).toContain('Modelo X');
    expect(result.whatsappSent).toBe(false);
  });

  it('COMPLAINT sempre escala', async () => {
    stubClassify(AiIntent.COMPLAINT, { confidence: 0.92 });
    kbResolver.resolve.mockResolvedValue({
      bestMatch: null,
      confidence: 0,
      source: null,
    });
    intentService.evaluateEscalation.mockReturnValue({
      escalated: true,
      escalationReason: 'COMPLAINT',
    });

    const result = await service.handleInbound({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'péssimo serviço quero reclamar',
    });

    expect(result.requiresHuman).toBe(true);
    expect(result.whatsappSent).toBe(false);
    expect(auditWrites.map((a) => a.action)).toContain(AI_ESCALATED);
    expect(prom.recordAiIntent).toHaveBeenCalledWith(AiIntent.COMPLAINT);
  });

  it('HUMAN sempre escala', async () => {
    stubClassify(AiIntent.HUMAN, { confidence: 0.95 });
    kbResolver.resolve.mockResolvedValue({
      bestMatch: null,
      confidence: 0,
      source: null,
    });
    intentService.evaluateEscalation.mockReturnValue({
      escalated: true,
      escalationReason: 'HUMAN',
    });

    const result = await service.handleInbound({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'quero falar com atendente',
    });

    expect(result.requiresHuman).toBe(true);
    expect(result.whatsappSent).toBe(false);
    expect(auditWrites.map((a) => a.action)).toContain(AI_ESCALATED);
  });

  it('UNKNOWN sempre escala', async () => {
    stubClassify(AiIntent.UNKNOWN, { confidence: 0.4 });
    kbResolver.resolve.mockResolvedValue({
      bestMatch: null,
      confidence: 0,
      source: null,
    });
    intentService.evaluateEscalation.mockReturnValue({
      escalated: true,
      escalationReason: 'UNKNOWN',
    });

    const result = await service.handleInbound({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'ok',
    });

    expect(result.requiresHuman).toBe(true);
    expect(result.whatsappSent).toBe(false);
  });

  it('modo OFF não classifica nem cria FollowUp', async () => {
    prisma.companyAiSettings.findFirst.mockResolvedValue({
      mode: AiAgentMode.OFF,
    });

    const result = await service.handleInbound({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'quanto custa?',
    });

    expect(result).toEqual({
      skipped: true,
      reason: 'AGENT_MODE_OFF',
      whatsappSent: false,
    });
    expect(intentService.classify).not.toHaveBeenCalled();
    expect(createdFollowUps).toHaveLength(0);
  });

  it('modo AUTO degrada para ASSIST sem auto-send', async () => {
    prisma.companyAiSettings.findFirst.mockResolvedValue({
      mode: AiAgentMode.AUTO,
    });
    stubClassify(AiIntent.PRICE);
    kbResolver.resolve.mockResolvedValue({
      bestMatch: {
        id: 'kb-price',
        kind: 'PRICE',
        title: 'Preço',
        body: 'R$ 10',
        tags: [],
      },
      confidence: 0.5,
      source: 'kb:PRICE:kb-price',
    });
    intentService.evaluateEscalation.mockReturnValue({
      escalated: false,
      escalationReason: null,
    });

    const result = await service.handleInbound({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'qual o preço?',
    });

    expect(result.skipped).toBe(false);
    expect(result.whatsappSent).toBe(false);
    expect(createdFollowUps[0].status).toBe(FollowUpStatus.SUGGESTED);
    expect(
      (createdFollowUps[0].metadata as { autoSend: boolean }).autoSend,
    ).toBe(false);
  });
});
