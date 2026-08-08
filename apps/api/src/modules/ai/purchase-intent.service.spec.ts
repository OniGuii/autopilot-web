import { AiIntent, LeadStatus } from '@prisma/client';
import {
  PURCHASE_INTENT_CALCULATED,
  PURCHASE_INTENT_CHANGED,
  PURCHASE_INTENT_VERY_HIGH,
} from './ai.constants';
import { PurchaseIntentService } from './purchase-intent.service';
import type { SalesMemory } from './sales-memory.types';

describe('PurchaseIntentService (11E.5)', () => {
  const baseMemory = (over: Partial<SalesMemory> = {}): SalesMemory => ({
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
    score: 40,
    temperature: 'WARM',
    lastScoreAt: new Date().toISOString(),
    nextBestAction: null,
    lastActionDecisionAt: null,
    purchaseIntent: null,
    purchaseIntentScore: 0,
    purchaseIntentUpdatedAt: null,
    ...over,
  });

  let memoryState: SalesMemory;
  const auditWrites: Array<{ action: string }> = [];

  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    lead: { findFirst: jest.fn() },
    message: { findMany: jest.fn() },
    followUp: { findFirst: jest.fn() },
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
        (metadata as { salesMemory?: SalesMemory }).salesMemory
      ) {
        return (metadata as { salesMemory: SalesMemory }).salesMemory;
      }
      return memoryState;
    }),
  };

  const prom = {
    recordPurchaseIntentCalculated: jest.fn(),
    recordPurchaseIntentChanged: jest.fn(),
    recordPurchaseIntentHigh: jest.fn(),
    recordPurchaseIntentVeryHigh: jest.fn(),
  };

  let service: PurchaseIntentService;

  beforeEach(() => {
    jest.clearAllMocks();
    auditWrites.length = 0;
    memoryState = baseMemory();
    prisma.message.findMany.mockResolvedValue([]);
    prisma.followUp.findFirst.mockResolvedValue(null);
    prisma.conversation.findFirst.mockImplementation(async () => ({
      id: 'conv-1',
      leadId: 'lead-1',
      metadata: { salesMemory: memoryState },
      lead: {
        id: 'lead-1',
        status: LeadStatus.RESPONDED,
        lastInboundAt: new Date(),
        lastOutboundAt: new Date(Date.now() - 3600_000),
      },
    }));
    prisma.conversation.update.mockResolvedValue({});
    service = new PurchaseIntentService(
      prisma as never,
      audit as never,
      salesMemory as never,
      prom as never,
    );
  });

  describe('calculate()', () => {
    it('HOT + orçamento + produto + pagamento → VERY_HIGH', () => {
      const result = service.calculate(
        baseMemory({
          temperature: 'HOT',
          score: 80,
          budget: 'R$ 900',
          productInterest: ['Plano Pro'],
          paymentPreference: 'Pix',
          city: 'Campinas',
          deliveryPreference: 'Entrega',
          nextBestAction: 'OFFER_CLOSE',
        }),
        { intentHistory: [AiIntent.PRICE, AiIntent.PAYMENT] },
      );
      expect(result.purchaseIntentScore).toBeGreaterThanOrEqual(90);
      expect(result.purchaseIntent).toBe('VERY_HIGH');
    });

    it('Lead morno → MEDIUM', () => {
      const result = service.calculate(
        baseMemory({
          temperature: 'WARM',
          score: 55,
          budget: 'R$ 300',
          city: 'SP',
          productInterest: ['Plano'],
        }),
      );
      expect(result.purchaseIntent).toBe('MEDIUM');
    });

    it('Lead frio → LOW', () => {
      const result = service.calculate(
        baseMemory({
          temperature: 'COLD',
          score: 20,
          budget: 'R$ 100',
          city: 'SP',
          productInterest: ['X'],
        }),
      );
      expect(result.purchaseIntent).toBe('LOW');
    });

    it('Lead perdido → VERY_LOW', () => {
      const result = service.calculate(
        baseMemory({
          temperature: 'HOT',
          score: 90,
          budget: 'R$ 999',
          productInterest: ['Pro'],
          paymentPreference: 'Pix',
        }),
        { leadStatus: LeadStatus.LOST },
      );
      expect(result.purchaseIntent).toBe('VERY_LOW');
      expect(result.purchaseIntentScore).toBeLessThanOrEqual(24);
    });

    it('AUTHORITY reduz score', () => {
      const base = service.calculate(
        baseMemory({
          temperature: 'WARM',
          score: 60,
          budget: 'R$ 400',
          city: 'Campinas',
          productInterest: ['Plano'],
        }),
      );
      const withAuth = service.calculate(
        baseMemory({
          temperature: 'WARM',
          score: 60,
          budget: 'R$ 400',
          city: 'Campinas',
          productInterest: ['Plano'],
          lastObjection: 'AUTHORITY',
        }),
      );
      expect(withAuth.purchaseIntentScore).toBeLessThan(
        base.purchaseIntentScore,
      );
      expect(withAuth.breakdown.authorityObjection).toBeDefined();
    });

    it('Recovery ignorado reduz score', () => {
      const base = service.calculate(
        baseMemory({
          temperature: 'WARM',
          score: 55,
          budget: 'R$ 200',
          city: 'SP',
          productInterest: ['A'],
        }),
      );
      const ignored = service.calculate(
        baseMemory({
          temperature: 'WARM',
          score: 55,
          budget: 'R$ 200',
          city: 'SP',
          productInterest: ['A'],
        }),
        { recoveryIgnored: true },
      );
      expect(ignored.purchaseIntentScore).toBeLessThan(
        base.purchaseIntentScore,
      );
    });
  });

  it('calculateAndPersist audits and metrics', async () => {
    memoryState = baseMemory({
      temperature: 'HOT',
      score: 85,
      budget: 'R$ 700',
      productInterest: ['Pro'],
      paymentPreference: 'Pix',
      city: 'Curitiba',
      deliveryPreference: 'Sedex',
      nextBestAction: 'OFFER_CLOSE',
      purchaseIntent: 'MEDIUM',
      purchaseIntentScore: 55,
      purchaseIntentUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const result = await service.calculateAndPersist({
      companyId: 'c1',
      conversationId: 'conv-1',
      leadId: 'lead-1',
      intent: AiIntent.PAYMENT,
    });

    expect(result.purchaseIntent).toBe('VERY_HIGH');
    expect(auditWrites.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        PURCHASE_INTENT_CALCULATED,
        PURCHASE_INTENT_CHANGED,
        PURCHASE_INTENT_VERY_HIGH,
      ]),
    );
    expect(prom.recordPurchaseIntentVeryHigh).toHaveBeenCalled();
  });

  it('getDashboard returns bands and revenue', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: '1',
        metadata: {
          salesMemory: baseMemory({
            purchaseIntent: 'VERY_HIGH',
            purchaseIntentScore: 95,
            purchaseIntentUpdatedAt: new Date().toISOString(),
            budget: 'R$ 1000',
          }),
        },
        lead: { status: LeadStatus.CONVERTED },
      },
      {
        id: '2',
        metadata: {
          salesMemory: baseMemory({
            purchaseIntent: 'LOW',
            purchaseIntentScore: 30,
            purchaseIntentUpdatedAt: new Date().toISOString(),
            budget: 'R$ 200',
          }),
        },
        lead: { status: LeadStatus.CONTACTED },
      },
    ]);

    const dash = await service.getDashboard({ cid: 'c1', sub: 'u1' });
    expect(dash.bands.VERY_HIGH).toBe(1);
    expect(dash.bands.LOW).toBe(1);
    expect(dash.conversionsByBand.VERY_HIGH).toBe(1);
    expect(dash.estimatedRevenueByBand.VERY_HIGH).toBe(1000);
  });
});
