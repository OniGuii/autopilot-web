import { NotFoundException } from '@nestjs/common';
import { FollowUpStatus, WebhookEventStatus } from '@prisma/client';
import { OpsService } from './ops.service';
import { OUTBOUND_MESSAGE_STATUS } from '../whatsapp/outbound/message-status';

describe('OpsService', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const otherCompany = '99999999-9999-9999-9999-999999999999';
  const actor = {
    sub: 'user-1',
    cid: companyId,
    mid: 'mem-1',
    role: 'OWNER',
  } as never;

  function build(opts?: {
    counts?: Partial<Record<string, number>>;
    instanceStatus?: string | null;
    messages?: Array<{ id: string }>;
    followUps?: Array<{ id: string; metadata?: unknown }>;
    auditRows?: unknown[];
    webhookRows?: unknown[];
    postgresOk?: boolean;
    redisOk?: boolean;
  }) {
    const counts = {
      totalMessages: 10,
      pendingMessages: 2,
      failedMessages: 1,
      scheduledFollowUps: 3,
      overdueFollowUps: 1,
      executedFollowUps: 5,
      pendingStale: 1,
      executingStale: 0,
      webhookFailedRecent: 0,
      ...(opts?.counts ?? {}),
    };

    const messageCalls: unknown[] = [];
    const followUpCalls: unknown[] = [];
    const audits: unknown[] = [];

    let messageFindResult = opts?.messages ?? [];
    let followUpFindResult = opts?.followUps ?? [];

    const prisma = {
      whatsAppInstance: {
        findFirst: jest.fn().mockResolvedValue(
          opts?.instanceStatus === null
            ? null
            : { status: opts?.instanceStatus ?? 'CONNECTED' },
        ),
      },
      message: {
        count: jest.fn().mockImplementation(async ({ where }) => {
          if (where.status === OUTBOUND_MESSAGE_STATUS.PENDING && where.createdAt) {
            return counts.pendingStale;
          }
          if (where.status === OUTBOUND_MESSAGE_STATUS.PENDING) {
            return counts.pendingMessages;
          }
          if (where.status === OUTBOUND_MESSAGE_STATUS.FAILED) {
            return counts.failedMessages;
          }
          return counts.totalMessages;
        }),
        findMany: jest.fn().mockImplementation(async () => messageFindResult),
        updateMany: jest.fn().mockImplementation(async ({ where }) => {
          messageCalls.push(where);
          return { count: 1 };
        }),
      },
      followUp: {
        count: jest.fn().mockImplementation(async ({ where }) => {
          if (where.status === FollowUpStatus.EXECUTING && where.updatedAt) {
            return counts.executingStale;
          }
          if (where.status === FollowUpStatus.SCHEDULED && !where.scheduledAt) {
            return counts.scheduledFollowUps;
          }
          if (where.status?.in && where.scheduledAt) {
            return counts.overdueFollowUps;
          }
          if (where.status === FollowUpStatus.EXECUTED) {
            return counts.executedFollowUps;
          }
          return 0;
        }),
        findMany: jest.fn().mockImplementation(async () => followUpFindResult),
        updateMany: jest.fn().mockImplementation(async ({ where }) => {
          followUpCalls.push(where);
          return { count: 1 };
        }),
      },
      webhookEvent: {
        count: jest.fn().mockResolvedValue(counts.webhookFailedRecent),
        findMany: jest.fn().mockResolvedValue(opts?.webhookRows ?? []),
        findFirst: jest.fn().mockImplementation(async ({ where }) => {
          const rows = (opts?.webhookRows ?? []) as Array<{
            id: string;
            companyId: string;
          }>;
          return (
            rows.find(
              (r) => r.id === where.id && r.companyId === where.companyId,
            ) ?? null
          );
        }),
      },
      auditLog: {
        count: jest.fn().mockResolvedValue((opts?.auditRows ?? []).length),
        findMany: jest.fn().mockResolvedValue(opts?.auditRows ?? []),
        findFirst: jest.fn().mockImplementation(async ({ where }) => {
          const rows = (opts?.auditRows ?? []) as Array<{
            id: string;
            companyId: string;
          }>;
          return (
            rows.find(
              (r) => r.id === where.id && r.companyId === where.companyId,
            ) ?? null
          );
        }),
      },
      $queryRaw: jest.fn().mockImplementation(async () => {
        if (opts?.postgresOk === false) throw new Error('db down');
        return [{ '?column?': 1 }];
      }),
      $transaction: jest.fn(async (arg: unknown) => {
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        if (typeof arg === 'function') {
          return arg({
            message: prisma.message,
            followUp: prisma.followUp,
          });
        }
        return arg;
      }),
    };

    const audit = {
      write: jest.fn(async (_tx: unknown, input: unknown) => {
        audits.push(input);
        return { id: 'audit-1' };
      }),
    };

    const config = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'redis.host') return 'localhost';
        if (key === 'redis.port') return 6379;
        if (key === 'redis.password') return undefined;
        return def;
      }),
    };

    const evolution = {
      isStubMode: jest.fn().mockReturnValue(true),
      getMetricsSnapshot: jest.fn().mockReturnValue({
        evolutionCircuitState: 'CLOSED',
        evolutionRequestsTotal: 0,
        evolutionRetriesTotal: 0,
        evolutionTimeoutsLast15m: 0,
        evolutionLastErrorAt: null,
        webhookInflight: 0,
        webhookP95Ms: null,
        webhookSlowLast15m: 0,
        connectionFlaps: 0,
        byResult: {},
      }),
    };

    const asyncMetrics = {
      snapshot: jest.fn().mockResolvedValue({
        whatsappInbound: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        dlqWhatsappInbound: 0,
      }),
    };

    const service = new OpsService(
      prisma as never,
      audit as never,
      config as never,
      evolution as never,
      asyncMetrics as never,
    );

    // Patch redis check via prototype spy when needed
    if (opts?.redisOk === false) {
      jest
        .spyOn(service as never, 'checkRedis' as never)
        .mockResolvedValue('down' as never);
    } else {
      jest
        .spyOn(service as never, 'checkRedis' as never)
        .mockResolvedValue('up' as never);
    }

    return {
      service,
      prisma,
      audit,
      audits,
      messageCalls,
      followUpCalls,
    };
  }

  it('returns operational metrics', async () => {
    const { service } = build();
    const metrics = await service.getMetrics(actor);
    expect(metrics).toEqual(
      expect.objectContaining({
        whatsappConnected: true,
        totalMessages: 10,
        pendingMessages: 2,
        failedMessages: 1,
        scheduledFollowUps: 3,
        overdueFollowUps: 1,
        executedFollowUps: 5,
        evolutionCircuitState: 'CLOSED',
        evolutionTimeoutsLast15m: 0,
        webhookInflight: 0,
        queues: expect.objectContaining({
          dlqWhatsappInbound: 0,
          whatsappInbound: expect.objectContaining({ waiting: 0 }),
        }),
      }),
    );
  });

  it('builds alerts when whatsapp disconnected and pending stale', async () => {
    const { service } = build({
      instanceStatus: 'DISCONNECTED',
      counts: { pendingStale: 2, failedMessages: 1, overdueFollowUps: 1 },
    });
    const result = await service.getAlerts(actor);
    const codes = result.alerts.map((a) => a.code);
    expect(codes).toContain('WHATSAPP_NOT_CONNECTED');
    expect(codes).toContain('PENDING_MESSAGES_STALE');
    expect(codes).toContain('FAILED_MESSAGES');
    expect(codes).toContain('OVERDUE_FOLLOWUPS');
  });

  it('health returns ok when dependencies are up', async () => {
    const { service } = build();
    const health = await service.getHealth(actor);
    expect(health.status).toBe('ok');
    expect(health.postgres).toBe('up');
    expect(health.redis).toBe('up');
    expect(health.whatsapp).toBe('up');
    expect(health.evolution).toEqual(
      expect.objectContaining({ circuit: 'CLOSED', stubMode: true }),
    );
    expect(health.queues).toEqual(
      expect.objectContaining({ dlqWhatsappInbound: 0 }),
    );
    expect(health.timestamp).toBeDefined();
  });

  it('health returns degraded when whatsapp down', async () => {
    const { service } = build({ instanceStatus: 'DISCONNECTED' });
    const health = await service.getHealth(actor);
    expect(health.status).toBe('degraded');
    expect(health.whatsapp).toBe('down');
  });

  it('health returns error when postgres down', async () => {
    const { service } = build({ postgresOk: false });
    const health = await service.getHealth(actor);
    expect(health.status).toBe('error');
    expect(health.postgres).toBe('down');
  });

  it('lists audit logs ordered and paginated', async () => {
    const rows = [
      {
        id: 'a1',
        companyId,
        action: 'FOLLOWUP_EXECUTE',
        occurredAt: new Date(),
      },
    ];
    const { service, prisma } = build({ auditRows: rows });
    const result = await service.listAudit(actor, { page: 1, limit: 20 });
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { occurredAt: 'desc' },
      }),
    );
  });

  it('getAudit 404 for other tenant', async () => {
    const { service } = build({
      auditRows: [{ id: 'a1', companyId }],
    });
    await expect(
      service.getAudit({ ...actor, cid: otherCompany } as never, 'a1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists webhooks with filters', async () => {
    const rows = [
      {
        id: 'w1',
        companyId,
        status: WebhookEventStatus.FAILED,
        eventType: 'messages.upsert',
        payload: { ok: true },
      },
    ];
    const { service } = build({ webhookRows: rows });
    const result = await service.listWebhooks(actor, {
      status: WebhookEventStatus.FAILED,
      page: 1,
      limit: 10,
    });
    expect(result.data).toEqual(rows);
  });

  it('reconcile messages dry-run does not update', async () => {
    const { service, prisma, audits } = build({
      messages: [{ id: 'm1' }, { id: 'm2' }],
    });
    const result = await service.reconcileMessages(actor, false);
    expect(result).toEqual({
      apply: false,
      encontrados: 2,
      corrigidos: 0,
      ignorados: 2,
    });
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
  });

  it('reconcile messages apply marks FAILED and audits', async () => {
    const { service, prisma, audits } = build({
      messages: [{ id: 'm1' }],
    });
    const result = await service.reconcileMessages(actor, true);
    expect(result.encontrados).toBe(1);
    expect(result.corrigidos).toBe(1);
    expect(prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OUTBOUND_MESSAGE_STATUS.FAILED,
          errorMessage: 'PENDING_TIMEOUT',
        }),
      }),
    );
    expect(audits.map((a) => (a as { action: string }).action)).toContain(
      'OPS_RECONCILE_MESSAGES',
    );
  });

  it('reconcile followups dry-run and apply', async () => {
    const dry = build({
      followUps: [{ id: 'f1', metadata: { attemptCount: 1 } }],
    });
    const dryResult = await dry.service.reconcileFollowUps(actor, false);
    expect(dryResult.corrigidos).toBe(0);
    expect(dry.prisma.followUp.updateMany).not.toHaveBeenCalled();

    const apply = build({
      followUps: [{ id: 'f1', metadata: { attemptCount: 1 } }],
    });
    const applyResult = await apply.service.reconcileFollowUps(actor, true);
    expect(applyResult.corrigidos).toBe(1);
    expect(apply.audits.map((a) => (a as { action: string }).action)).toContain(
      'OPS_RECONCILE_FOLLOWUPS',
    );
  });
});
