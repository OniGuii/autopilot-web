import { AiIntent, FollowUpStatus, LeadStatus } from '@prisma/client';
import {
  LEAD_BECAME_HOT,
  LEAD_SCORE_UPDATED,
  LEAD_SCORE_WEIGHTS,
} from './ai.constants';
import { LeadScoringService } from './lead-scoring.service';
import { SalesMemoryService } from './sales-memory.service';
import type { SalesMemory } from './sales-memory.types';

describe('LeadScoringService (11E.2)', () => {
  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    message: { count: jest.fn() },
    followUp: { findFirst: jest.fn() },
    lead: { update: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { write: jest.fn() };
  const salesMemory = {
    readFromMetadata: jest.fn(),
  };
  const prom = { recordLeadScoreTemperature: jest.fn() };

  let service: LeadScoringService;
  let memory: SalesMemory;

  beforeEach(() => {
    jest.clearAllMocks();
    memory = {
      ...new SalesMemoryService(
        {} as never,
        {} as never,
        {} as never,
      ).emptyMemory(),
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    salesMemory.readFromMetadata.mockImplementation(() => ({ ...memory }));
    prisma.message.count.mockResolvedValue(1);
    prisma.followUp.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    audit.write.mockResolvedValue({});
    prisma.conversation.update.mockResolvedValue({});
    prisma.lead.update.mockResolvedValue({});
    service = new LeadScoringService(
      prisma as never,
      audit as never,
      salesMemory as never,
      prom as never,
    );
  });

  describe('getTemperature', () => {
    it('maps bands COLD / WARM / HOT', () => {
      expect(service.getTemperature(0)).toBe('COLD');
      expect(service.getTemperature(39)).toBe('COLD');
      expect(service.getTemperature(40)).toBe('WARM');
      expect(service.getTemperature(69)).toBe('WARM');
      expect(service.getTemperature(70)).toBe('HOT');
      expect(service.getTemperature(100)).toBe('HOT');
    });
  });

  describe('calculate', () => {
    it('increases score with product, price, budget, payment', () => {
      const empty = service.calculate(
        new SalesMemoryService(
          {} as never,
          {} as never,
          {} as never,
        ).emptyMemory(),
        {},
      );
      memory.productInterest = ['Plano Pro'];
      memory.budget = 'R$ 500';
      memory.paymentPreference = 'Pix';
      const r = service.calculate(memory, { intent: AiIntent.PRICE });
      expect(r.score).toBeGreaterThan(empty.score);
      expect(r.score).toBeGreaterThanOrEqual(
        LEAD_SCORE_WEIGHTS.askedProduct +
          LEAD_SCORE_WEIGHTS.askedPrice +
          LEAD_SCORE_WEIGHTS.hasBudget +
          LEAD_SCORE_WEIGHTS.askedPayment,
      );
      expect(r.temperature).toBe('WARM');
    });

    it('reaches HOT with strong purchase signals', () => {
      memory.productInterest = ['Plano Pro'];
      memory.budget = 'R$ 500';
      memory.paymentPreference = 'Pix';
      memory.city = 'Campinas';
      memory.purchaseIntentLevel = 'HIGH';
      memory.urgency = 'HIGH';
      const r = service.calculate(memory, { intent: AiIntent.PRICE });
      expect(r.score).toBeGreaterThanOrEqual(70);
      expect(r.temperature).toBe('HOT');
    });

    it('decreases score on strong objection and LOST', () => {
      memory.productInterest = ['X'];
      memory.budget = 'R$ 300';
      memory.paymentPreference = 'Pix';
      memory.city = 'SP';
      memory.lastObjection = 'PRICE';
      const withObjection = service.calculate(memory, {});
      const withoutObjection = service.calculate(
        { ...memory, lastObjection: null },
        {},
      );
      expect(withObjection.score).toBeLessThan(withoutObjection.score);
      expect(withObjection.breakdown.objection).toBe(
        LEAD_SCORE_WEIGHTS.strongObjection,
      );

      const lost = service.calculate(memory, {
        leadStatus: LeadStatus.LOST,
      });
      expect(lost.score).toBeLessThan(withObjection.score);
      expect(lost.breakdown.leadLost).toBe(LEAD_SCORE_WEIGHTS.leadLost);
    });

    it('awards recovery reply and multi-interaction', () => {
      const r = service.calculate(memory, {
        repliedRecovery: true,
        inboundCount: 4,
      });
      expect(r.breakdown.repliedRecovery).toBe(
        LEAD_SCORE_WEIGHTS.repliedRecovery,
      );
      expect(r.breakdown.multiInteraction).toBe(
        Math.min(3 * LEAD_SCORE_WEIGHTS.multiInteractionPerExtra, 10),
      );
    });
  });

  describe('updateScore', () => {
    beforeEach(() => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        leadId: 'lead-1',
        metadata: { salesMemory: memory },
        lead: {
          id: 'lead-1',
          status: LeadStatus.RESPONDED,
          score: 0,
          lastInboundAt: new Date(),
          lastOutboundAt: new Date(Date.now() - 3600_000),
        },
      });
    });

    it('persists score, audits, mirrors Lead.score, temperature change', async () => {
      memory.budget = 'R$ 800';
      memory.productInterest = ['Pro'];
      memory.paymentPreference = 'Pix';
      memory.purchaseIntentLevel = 'HIGH';
      memory.city = 'Campinas';
      salesMemory.readFromMetadata.mockReturnValue({ ...memory });

      const res = await service.updateScore({
        companyId: 'c1',
        conversationId: 'conv-1',
        leadId: 'lead-1',
        intent: AiIntent.PRICE,
      });

      expect(res.changed).toBe(true);
      expect(res.temperature).toBe('HOT');
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-1' },
          data: { score: res.score },
        }),
      );
      expect(audit.write).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: LEAD_SCORE_UPDATED }),
      );
      expect(audit.write).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: LEAD_BECAME_HOT }),
      );
      expect(prom.recordLeadScoreTemperature).toHaveBeenCalledWith('HOT');
    });

    it('isolates by companyId (conversation not found)', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      await expect(
        service.updateScore({
          companyId: 'other',
          conversationId: 'conv-1',
        }),
      ).rejects.toThrow('Conversation not found');
    });

    it('detects recovery reply signal', async () => {
      prisma.followUp.findFirst.mockResolvedValue({
        id: 'fu-rec',
        status: FollowUpStatus.EXECUTED,
      });
      memory.budget = 'R$ 100';
      salesMemory.readFromMetadata.mockReturnValue({ ...memory });

      const res = await service.updateScore({
        companyId: 'c1',
        conversationId: 'conv-1',
      });
      expect(res.breakdown.repliedRecovery).toBe(
        LEAD_SCORE_WEIGHTS.repliedRecovery,
      );
    });
  });
});
