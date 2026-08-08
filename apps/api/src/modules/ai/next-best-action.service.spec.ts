import { LeadStatus } from '@prisma/client';
import { NBA_CHANGED, NBA_DECIDED, NBA_EXECUTED } from './ai.constants';
import { NextBestActionService } from './next-best-action.service';
import type { SalesMemory } from './sales-memory.types';

describe('NextBestActionService (11E.4)', () => {
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
    recordNbaDecided: jest.fn(),
    recordNbaChanged: jest.fn(),
    recordNbaExecuted: jest.fn(),
  };

  let service: NextBestActionService;

  beforeEach(() => {
    jest.clearAllMocks();
    auditWrites.length = 0;
    memoryState = baseMemory();
    prisma.followUp.findFirst.mockResolvedValue(null);
    prisma.conversation.findFirst.mockImplementation(async () => ({
      id: 'conv-1',
      leadId: 'lead-1',
      metadata: { salesMemory: memoryState },
      agentPaused: false,
      lead: {
        id: 'lead-1',
        status: LeadStatus.RESPONDED,
        lastInboundAt: new Date(),
        lastOutboundAt: new Date(Date.now() - 3600_000),
        name: 'Lead',
      },
    }));
    prisma.conversation.update.mockResolvedValue({});
    service = new NextBestActionService(
      prisma as never,
      audit as never,
      salesMemory as never,
      prom as never,
    );
  });

  describe('decide()', () => {
    it('HOT + payment + delivery + product → OFFER_CLOSE', () => {
      const result = service.decide({
        memory: baseMemory({
          temperature: 'HOT',
          score: 80,
          productInterest: ['Plano Pro'],
          paymentPreference: 'Pix',
          deliveryPreference: 'Entrega',
          budget: 'R$ 500',
          city: 'Campinas',
        }),
        leadStatus: LeadStatus.RESPONDED,
      });
      expect(result.action).toBe('OFFER_CLOSE');
    });

    it('Sem orçamento → ASK_BUDGET', () => {
      const result = service.decide({
        memory: baseMemory({ budget: null, city: 'SP' }),
        leadStatus: LeadStatus.RESPONDED,
      });
      expect(result.action).toBe('ASK_BUDGET');
    });

    it('Sem cidade → ASK_CITY', () => {
      const result = service.decide({
        memory: baseMemory({ budget: 'R$ 200', city: null }),
        leadStatus: LeadStatus.RESPONDED,
      });
      expect(result.action).toBe('ASK_CITY');
    });

    it('Objeção ativa → HANDLE_OBJECTION', () => {
      const result = service.decide({
        memory: baseMemory({ lastObjection: 'TRUST' }),
        leadStatus: LeadStatus.RESPONDED,
      });
      expect(result.action).toBe('HANDLE_OBJECTION');
    });

    it('AUTHORITY → ESCALATE_HUMAN', () => {
      const result = service.decide({
        memory: baseMemory({ lastObjection: 'AUTHORITY' }),
        leadStatus: LeadStatus.RESPONDED,
      });
      expect(result.action).toBe('ESCALATE_HUMAN');
    });

    it('Lead perdido → WAIT', () => {
      const result = service.decide({
        memory: baseMemory({
          temperature: 'HOT',
          productInterest: ['X'],
          paymentPreference: 'Pix',
          deliveryPreference: 'Entrega',
          budget: 'R$ 1',
          city: 'SP',
        }),
        leadStatus: LeadStatus.LOST,
      });
      expect(result.action).toBe('WAIT');
      expect(result.reason).toBe('LEAD_LOST');
    });

    it('PRICE objection → OFFER_ALTERNATIVE', () => {
      const result = service.decide({
        memory: baseMemory({ lastObjection: 'PRICE' }),
        leadStatus: LeadStatus.RESPONDED,
      });
      expect(result.action).toBe('OFFER_ALTERNATIVE');
    });

    it('silence without inbound → SCHEDULE_RECOVERY', () => {
      const result = service.decide({
        memory: baseMemory({
          budget: 'R$ 100',
          city: 'Campinas',
          productInterest: ['Plano'],
          paymentPreference: 'Pix',
        }),
        leadStatus: LeadStatus.CONTACTED,
        lastOutboundAt: new Date(Date.now() - 5 * 24 * 3600_000),
        lastInboundAt: new Date(Date.now() - 10 * 24 * 3600_000),
        hasPendingRecovery: false,
      });
      expect(result.action).toBe('SCHEDULE_RECOVERY');
    });
  });

  it('decideAndPersist audits NBA_DECIDED and NBA_CHANGED', async () => {
    memoryState = baseMemory({
      nextBestAction: 'ASK_CITY',
      budget: null,
    });
    const result = await service.decideAndPersist({
      companyId: 'c1',
      conversationId: 'conv-1',
      leadId: 'lead-1',
    });
    expect(result.action).toBe('ASK_BUDGET');
    expect(result.changed).toBe(true);
    expect(auditWrites.map((a) => a.action)).toEqual(
      expect.arrayContaining([NBA_DECIDED, NBA_CHANGED]),
    );
    expect(prom.recordNbaDecided).toHaveBeenCalledWith('ASK_BUDGET');
    expect(prom.recordNbaChanged).toHaveBeenCalledWith('ASK_BUDGET');
  });

  it('enrichSuggestedBody adds NBA line without executing actions', () => {
    const { body, enrichment } = service.enrichSuggestedBody('Olá!', {
      action: 'ASK_BUDGET',
      replyGoal: 'Descobrir orçamento',
    });
    expect(body).toMatch(/ASK_BUDGET/);
    expect(body).toMatch(/orçamento/i);
    expect(enrichment.action).toBe('ASK_BUDGET');
  });

  it('markExecuted audits NBA_EXECUTED', async () => {
    await service.markExecuted({
      companyId: 'c1',
      conversationId: 'conv-1',
      action: 'ASK_BUDGET',
      mode: 'ASSIST',
      followUpId: 'fu-1',
    });
    expect(auditWrites.map((a) => a.action)).toContain(NBA_EXECUTED);
    expect(prom.recordNbaExecuted).toHaveBeenCalledWith('ASK_BUDGET');
  });

  it('getDashboard returns top actions', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: '1',
        metadata: {
          salesMemory: baseMemory({
            nextBestAction: 'ASK_BUDGET',
            temperature: 'WARM',
          }),
        },
        lead: { status: LeadStatus.RESPONDED },
      },
      {
        id: '2',
        metadata: {
          salesMemory: baseMemory({
            nextBestAction: 'OFFER_CLOSE',
            temperature: 'HOT',
          }),
        },
        lead: { status: LeadStatus.CONVERTED },
      },
    ]);
    const dash = await service.getDashboard({ cid: 'c1', sub: 'u1' });
    expect(dash.topActions.some((a) => a.action === 'ASK_BUDGET')).toBe(true);
    expect(dash.conversionsByAction.OFFER_CLOSE).toBe(1);
    expect(dash.temperaturesByAction.OFFER_CLOSE.HOT).toBe(1);
  });
});
