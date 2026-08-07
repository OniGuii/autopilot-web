import { AiIntent, KnowledgeBaseKind } from '@prisma/client';
import { AiIntentService } from './ai-intent.service';
import { KnowledgeBaseService } from './knowledge-base.service';

describe('AiIntentService (11A)', () => {
  const audit = { write: jest.fn().mockResolvedValue({ id: 'a1' }) };
  const prisma = {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ auditLog: { create: jest.fn() } }),
    ),
  };
  const kb = {
    listActiveKinds: jest.fn(),
  };
  const prom = {
    recordAiClassification: jest.fn(),
    recordAiEscalation: jest.fn(),
    recordAiKbMatch: jest.fn(),
  };

  let service: AiIntentService;

  beforeEach(() => {
    jest.clearAllMocks();
    kb.listActiveKinds.mockResolvedValue(new Set());
    service = new AiIntentService(
      prisma as never,
      audit as never,
      kb as unknown as KnowledgeBaseService,
      prom as never,
    );
  });

  describe('classifyHeuristic', () => {
    it('detects HUMAN', () => {
      const hit = service.classifyHeuristic(
        'quero falar com atendente',
        'quero falar com atendente',
      );
      expect(hit.intent).toBe(AiIntent.HUMAN);
      expect(hit.confidence).toBeGreaterThan(0.9);
    });

    it('detects COMPLAINT', () => {
      const hit = service.classifyHeuristic(
        'isso é um absurdo péssimo',
        'isso é um absurdo péssimo',
      );
      expect(hit.intent).toBe(AiIntent.COMPLAINT);
    });

    it('detects PRICE', () => {
      const hit = service.classifyHeuristic(
        'quanto custa o produto?',
        'quanto custa o produto?',
      );
      expect(hit.intent).toBe(AiIntent.PRICE);
    });

    it('detects PAYMENT', () => {
      const hit = service.classifyHeuristic(
        'vocês aceitam pix?',
        'vocês aceitam pix?',
      );
      expect(hit.intent).toBe(AiIntent.PAYMENT);
    });

    it('detects DELIVERY', () => {
      const hit = service.classifyHeuristic(
        'qual o prazo de entrega?',
        'qual o prazo de entrega?',
      );
      expect(hit.intent).toBe(AiIntent.DELIVERY);
    });

    it('detects PRODUCT', () => {
      const hit = service.classifyHeuristic(
        'vocês têm esse modelo em estoque?',
        'vocês têm esse modelo em estoque?',
      );
      expect(hit.intent).toBe(AiIntent.PRODUCT);
    });

    it('detects HOURS', () => {
      const hit = service.classifyHeuristic(
        'qual o horário de funcionamento?',
        'qual o horário de funcionamento?',
      );
      expect(hit.intent).toBe(AiIntent.HOURS);
    });

    it('detects ADDRESS', () => {
      const hit = service.classifyHeuristic(
        'qual o endereço de vocês?',
        'qual o endereço de vocês?',
      );
      expect(hit.intent).toBe(AiIntent.ADDRESS);
    });

    it('falls back to UNKNOWN', () => {
      const hit = service.classifyHeuristic('ok', 'ok');
      expect(hit.intent).toBe(AiIntent.UNKNOWN);
    });
  });

  describe('evaluateEscalation', () => {
    it('always escalates COMPLAINT and HUMAN and UNKNOWN', () => {
      expect(
        service.evaluateEscalation(AiIntent.COMPLAINT, true, false).escalated,
      ).toBe(true);
      expect(
        service.evaluateEscalation(AiIntent.HUMAN, false, false).escalated,
      ).toBe(true);
      expect(
        service.evaluateEscalation(AiIntent.UNKNOWN, false, false)
          .escalationReason,
      ).toBe('UNKNOWN');
    });

    it('escalates PRICE without KB', () => {
      const r = service.evaluateEscalation(AiIntent.PRICE, false, true);
      expect(r).toEqual({
        escalated: true,
        escalationReason: 'PRICE_WITHOUT_KB',
      });
    });

    it('escalates PRODUCT / PAYMENT / DELIVERY without KB (11B)', () => {
      expect(service.evaluateEscalation(AiIntent.PRODUCT, false, true)).toEqual(
        {
          escalated: true,
          escalationReason: 'PRODUCT_WITHOUT_KB',
        },
      );
      expect(service.evaluateEscalation(AiIntent.PAYMENT, false, true)).toEqual(
        {
          escalated: true,
          escalationReason: 'PAYMENT_WITHOUT_KB',
        },
      );
      expect(
        service.evaluateEscalation(AiIntent.DELIVERY, false, true),
      ).toEqual({
        escalated: true,
        escalationReason: 'DELIVERY_WITHOUT_KB',
      });
    });

    it('does not escalate PRICE with KB', () => {
      const r = service.evaluateEscalation(AiIntent.PRICE, true, true);
      expect(r.escalated).toBe(false);
    });
  });

  describe('classify', () => {
    it('escalates PRICE when KB has no price/product', async () => {
      kb.listActiveKinds.mockResolvedValue(new Set([KnowledgeBaseKind.HOURS]));
      const result = await service.classify({
        companyId: 'c1',
        message: 'quanto custa?',
        actorUserId: 'u1',
      });
      expect(result.intent).toBe(AiIntent.PRICE);
      expect(result.escalated).toBe(true);
      expect(result.escalationReason).toBe('PRICE_WITHOUT_KB');
      expect(result.kbMatched).toBe(false);
      expect(prom.recordAiClassification).toHaveBeenCalled();
      expect(prom.recordAiEscalation).toHaveBeenCalled();
      expect(audit.write).toHaveBeenCalled();
    });

    it('matches KB for PRICE when PRICE kind exists', async () => {
      kb.listActiveKinds.mockResolvedValue(new Set([KnowledgeBaseKind.PRICE]));
      const result = await service.classify({
        companyId: 'c1',
        message: 'qual o preço?',
        actorUserId: 'u1',
      });
      expect(result.kbMatched).toBe(true);
      expect(result.escalated).toBe(false);
      expect(prom.recordAiKbMatch).toHaveBeenCalled();
    });
  });
});
