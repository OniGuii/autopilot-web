import { AiIntent } from '@prisma/client';
import {
  OBJECTION_DETECTED,
  OBJECTION_ESCALATED,
  OBJECTION_HANDLED,
} from './ai.constants';
import { ObjectionDetectionService } from './objection-detection.service';
import { ObjectionEngineService } from './objection-engine.service';
import type { SalesMemory } from './sales-memory.types';

describe('ObjectionEngineService (11E.3)', () => {
  const companyId = 'c1';
  const conversationId = 'conv-1';
  const leadId = 'lead-1';
  const messageId = 'msg-1';

  const auditWrites: Array<{ action: string; after?: unknown }> = [];

  const baseMemory = (): SalesMemory => ({
    budget: null,
    productInterest: [],
    city: null,
    urgency: null,
    paymentPreference: null,
    deliveryPreference: null,
    lastObjection: null,
    objectionHistory: [],
    purchaseIntentLevel: 'NONE',
    version: 1,
    updatedAt: new Date().toISOString(),
    sourceMessageIds: [],
    score: 55,
    temperature: 'WARM',
    lastScoreAt: new Date().toISOString(),
  });

  let memoryState: SalesMemory;

  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        conversation: { update: prisma.conversation.update },
      }),
    ),
  };

  const audit = {
    write: jest.fn(async (_tx: unknown, data: { action: string }) => {
      auditWrites.push(data);
      return { id: 'a1' };
    }),
  };

  const salesMemory = {
    readFromMetadata: jest.fn((metadata: unknown) => {
      if (
        metadata &&
        typeof metadata === 'object' &&
        !Array.isArray(metadata) &&
        (metadata as { salesMemory?: SalesMemory }).salesMemory
      ) {
        return (metadata as { salesMemory: SalesMemory }).salesMemory;
      }
      return memoryState;
    }),
  };

  const kbResolver = {
    resolve: jest.fn(async () => ({
      bestMatch: {
        id: 'kb1',
        title: 'Preço Plano Pro',
        body: 'Plano Pro por R$ 199/mês com suporte.',
        kind: 'PRICE',
      },
      confidence: 0.9,
      source: 'kb',
    })),
  };

  const prom = {
    recordObjectionDetected: jest.fn(),
    recordObjectionHandled: jest.fn(),
    recordObjectionEscalated: jest.fn(),
  };

  let service: ObjectionEngineService;

  beforeEach(() => {
    jest.clearAllMocks();
    auditWrites.length = 0;
    memoryState = baseMemory();
    prisma.conversation.findFirst.mockImplementation(async () => ({
      id: conversationId,
      metadata: { salesMemory: memoryState },
    }));
    prisma.conversation.update.mockResolvedValue({});
    service = new ObjectionEngineService(
      prisma as never,
      audit as never,
      new ObjectionDetectionService(),
      salesMemory as never,
      kbResolver as never,
      prom as never,
    );
  });

  it('handles PRICE with reply and canAuto on WARM', async () => {
    const result = await service.handle({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'Tá caro para mim',
      intent: AiIntent.PRICE,
    });

    expect(result.detected).toBe(true);
    expect(result.type).toBe('PRICE');
    expect(result.canAuto).toBe(true);
    expect(result.requiresHuman).toBe(false);
    expect(result.body).toMatch(/investimento|benefício|orçamento/i);
    expect(auditWrites.map((a) => a.action)).toEqual(
      expect.arrayContaining([OBJECTION_DETECTED, OBJECTION_HANDLED]),
    );
    expect(prom.recordObjectionDetected).toHaveBeenCalledWith('PRICE');
    expect(prom.recordObjectionHandled).toHaveBeenCalledWith('PRICE');
  });

  it('never AUTO for AUTHORITY and escalates', async () => {
    const result = await service.handle({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'Vou falar com meu sócio',
    });

    expect(result.type).toBe('AUTHORITY');
    expect(result.canAuto).toBe(false);
    expect(result.requiresHuman).toBe(true);
    expect(result.requiresHumanReason).toBe('OBJECTION_AUTHORITY');
    expect(auditWrites.map((a) => a.action)).toContain(OBJECTION_ESCALATED);
    expect(prom.recordObjectionEscalated).toHaveBeenCalledWith('AUTHORITY');
  });

  it('never AUTO for NEED', async () => {
    const result = await service.handle({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'Não vejo vantagem nisso',
    });
    expect(result.type).toBe('NEED');
    expect(result.canAuto).toBe(false);
    expect(result.requiresHumanReason).toBe('OBJECTION_NEED');
  });

  it('never AUTO for COMPARISON', async () => {
    const result = await service.handle({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'Estou comparando com outra loja',
    });
    expect(result.type).toBe('COMPARISON');
    expect(result.canAuto).toBe(false);
    expect(result.requiresHuman).toBe(false);
  });

  it('blocks AUTO when temperature is COLD', async () => {
    memoryState = { ...baseMemory(), temperature: 'COLD', score: 10 };
    const result = await service.handle({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'Vou pensar',
    });
    expect(result.type).toBe('TIME');
    expect(result.canAuto).toBe(false);
  });

  it('escalates repeated objections of same type', async () => {
    memoryState = {
      ...baseMemory(),
      lastObjection: 'PRICE',
      objectionHistory: [
        {
          type: 'PRICE',
          at: new Date(Date.now() - 60_000).toISOString(),
          messageId: 'old',
        },
      ],
    };
    const result = await service.handle({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'Continua caro',
    });
    expect(result.requiresHuman).toBe(true);
    expect(result.requiresHumanReason).toBe('OBJECTION_REPEATED');
    expect(result.canAuto).toBe(false);
  });

  it('escalates HOT lead without advance', async () => {
    memoryState = {
      ...baseMemory(),
      temperature: 'HOT',
      score: 80,
      purchaseIntentLevel: 'NONE',
      objectionHistory: [
        {
          type: 'TIME',
          at: new Date(Date.now() - 120_000).toISOString(),
        },
      ],
    };
    const result = await service.handle({
      companyId,
      conversationId,
      leadId,
      messageId,
      messageBody: 'É confiável mesmo?',
    });
    expect(result.type).toBe('TRUST');
    expect(result.requiresHumanReason).toBe('HOT_LEAD_NO_ADVANCE');
  });

  it('getDashboard returns top objections', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: '1',
        metadata: {
          salesMemory: {
            ...baseMemory(),
            lastObjection: 'PRICE',
            objectionHistory: [
              { type: 'PRICE', at: '2026-01-01T00:00:00.000Z' },
              { type: 'PRICE', at: '2026-01-02T00:00:00.000Z' },
              { type: 'TIME', at: '2026-01-03T00:00:00.000Z' },
            ],
          },
        },
      },
    ]);

    const dash = await service.getDashboard({ cid: companyId, sub: 'u1' });
    expect(dash.topObjections[0]).toEqual({ type: 'PRICE', count: 2 });
    expect(dash.totals.TIME).toBe(1);
    expect(dash.conversationsWithObjection).toBe(1);
  });

  it('isAutoAllowed only for PRICE/TIME/TRUST + WARM/HOT', () => {
    expect(service.isAutoAllowed('PRICE', 'HOT')).toBe(true);
    expect(service.isAutoAllowed('TIME', 'WARM')).toBe(true);
    expect(service.isAutoAllowed('TRUST', 'COLD')).toBe(false);
    expect(service.isAutoAllowed('AUTHORITY', 'HOT')).toBe(false);
    expect(service.isAutoAllowed('COMPARISON', 'WARM')).toBe(false);
    expect(service.isAutoAllowed('NEED', 'HOT')).toBe(false);
    expect(service.isAutoAllowed('UNKNOWN', 'HOT')).toBe(false);
  });
});
