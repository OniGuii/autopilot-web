import { FollowUpStatus, WebhookEventStatus } from '@prisma/client';
import { ReconcileCycleService } from './reconcile-cycle.service';
import { OUTBOUND_MESSAGE_STATUS } from '../whatsapp/outbound/message-status';

describe('ReconcileCycleService', () => {
  it('times out PENDING messages, flags EXECUTING suspects, counts stale webhooks', async () => {
    const companyId = 'c1';
    const prisma = {
      message: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ companyId }]) // distinct companies
          .mockResolvedValue([]),
      },
      followUp: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ companyId }])
          .mockResolvedValueOnce([
            { id: 'fu-1', metadata: {} },
            { id: 'fu-2', metadata: { reconcileSuspect: true } },
          ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      webhookEvent: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ companyId }])
          .mockResolvedValueOnce([{ id: 'we-1' }, { id: 'we-2' }]),
      },
      company: {
        findMany: jest.fn().mockResolvedValue([{ id: companyId }]),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'mem-1',
          userId: 'user-1',
          role: 'OWNER',
        }),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({})),
    };

    const audit = { write: jest.fn() };
    const ops = {
      reconcileMessages: jest.fn().mockResolvedValue({
        apply: true,
        encontrados: 2,
        corrigidos: 2,
        ignorados: 0,
      }),
    };
    const metrics = {
      snapshot: jest.fn().mockResolvedValue({
        dlqWhatsappInbound: 1,
        dlq: { depth: 1, oldestAgeMs: 9_000 },
      }),
      recordReconcileRun: jest.fn(),
    };

    const service = new ReconcileCycleService(
      prisma as never,
      audit,
      ops as never,
      metrics as never,
    );

    const result = await service.runCycle({
      v: 1,
      correlationId: 'corr-1',
      trigger: 'schedule',
      take: 100,
    });

    expect(ops.reconcileMessages).toHaveBeenCalledWith(
      expect.objectContaining({ cid: companyId }),
      true,
      undefined,
      expect.any(Number),
    );
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: FollowUpStatus.EXECUTING,
        }),
        data: expect.objectContaining({
          metadata: expect.objectContaining({ reconcileSuspect: true }),
        }),
      }),
    );
    expect(result.messagesTimedOut).toBe(2);
    expect(result.followUpsSuspected).toBe(1);
    expect(result.staleWebhooks).toBe(2);
    expect(result.itemsFlagged).toBe(5);
    expect(metrics.recordReconcileRun).toHaveBeenCalled();
    expect(prisma.webhookEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: WebhookEventStatus.RECEIVED,
        }),
      }),
    );
    expect(OUTBOUND_MESSAGE_STATUS.PENDING).toBe('PENDING');
  });
});
