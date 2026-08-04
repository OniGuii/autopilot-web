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
    queueSnapshot?: Record<string, unknown>;
    seqScanRows?: Array<{
      relname: string;
      seq_scan: bigint;
      idx_scan: bigint | null;
    }>;
    prom?: {
      getHttpWindowStats?: () => {
        total: number;
        errors5xx: number;
        errorRate: number;
        p95Ms: number | null;
      };
      getPrismaSlowWindowStats?: () => {
        count: number;
        thresholdMs: number;
      };
    };
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

    const messageFindResult = opts?.messages ?? [];
    const followUpFindResult = opts?.followUps ?? [];

    const prisma = {
      whatsAppInstance: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts?.instanceStatus === null
              ? null
              : { status: opts?.instanceStatus ?? 'CONNECTED' },
          ),
      },
      message: {
        count: jest.fn().mockImplementation(async ({ where }) => {
          if (
            where.status === OUTBOUND_MESSAGE_STATUS.PENDING &&
            where.createdAt
          ) {
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
        count: jest.fn().mockImplementation(async ({ where }) => {
          if (
            where.status === WebhookEventStatus.RECEIVED &&
            where.receivedAt
          ) {
            return counts.staleReceivedWebhooks ?? 0;
          }
          if (where.status === WebhookEventStatus.FAILED) {
            return counts.webhookFailedRecent;
          }
          return counts.webhookFailedRecent;
        }),
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
      $queryRaw: jest.fn().mockImplementation(async (strings: unknown) => {
        if (opts?.postgresOk === false) throw new Error('db down');
        const sql = Array.isArray(strings)
          ? (strings as TemplateStringsArray).join(' ')
          : '';
        if (sql.includes('pg_stat_user_tables')) {
          return opts?.seqScanRows ?? [];
        }
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
      listForCompany: jest.fn(
        async (cid: string, query: { page?: number; limit?: number }) => {
          const page = query.page ?? 1;
          const limit = query.limit ?? 20;
          const rows = await prisma.auditLog.findMany({
            where: { companyId: cid },
            orderBy: { occurredAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
          });
          const total = await prisma.auditLog.count({
            where: { companyId: cid },
          });
          return {
            data: rows,
            meta: {
              page,
              limit,
              total,
              totalPages: total === 0 ? 0 : Math.ceil(total / limit),
            },
          };
        },
      ),
      getForCompany: jest.fn(async (cid: string, id: string) => {
        const row = await prisma.auditLog.findFirst({
          where: { id, companyId: cid },
        });
        if (!row) {
          throw new NotFoundException('Audit log not found');
        }
        return row;
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

    const defaultQueueSnapshot = {
      available: opts?.redisOk === false ? false : true,
      error: opts?.redisOk === false ? 'redis down' : undefined,
      whatsappInbound:
        opts?.redisOk === false
          ? null
          : {
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0,
            },
      followupScheduler:
        opts?.redisOk === false
          ? null
          : {
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0,
            },
      dlq: opts?.redisOk === false ? null : { depth: 0, oldestAgeMs: null },
      dlqWhatsappInbound: opts?.redisOk === false ? null : 0,
      processingDurationP95Ms: null,
      retriesTotal: 0,
      stalledTotal: 0,
      claimFailuresTotal: 0,
      reconcileWorker:
        opts?.redisOk === false
          ? null
          : {
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0,
            },
      aiSuggestions:
        opts?.redisOk === false
          ? null
          : {
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0,
            },
      outbound:
        opts?.redisOk === false
          ? null
          : {
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0,
              sent: 0,
              failures: 0,
              avgDuration: null,
            },
      reconcile: {
        runs: 0,
        durationMs: null,
        itemsChecked: 0,
        itemsFlagged: 0,
      },
      ai: {
        generated: 0,
        failed: 0,
        avgDuration: null,
      },
    };
    const asyncMetrics = {
      snapshot: jest
        .fn()
        .mockResolvedValue(opts?.queueSnapshot ?? defaultQueueSnapshot),
    };

    const service = new OpsService(
      prisma as never,
      audit,
      config as never,
      evolution as never,
      asyncMetrics as never,
      opts?.prom as never,
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
        staleReceivedWebhooks: 0,
        queues: expect.objectContaining({
          available: true,
          dlqWhatsappInbound: 0,
          dlqDepth: 0,
          whatsappInbound: expect.objectContaining({ waiting: 0 }),
          followupScheduler: expect.objectContaining({ waiting: 0 }),
          reconcileWorker: expect.objectContaining({ waiting: 0 }),
          aiSuggestions: expect.objectContaining({ waiting: 0 }),
          reconcile: expect.objectContaining({
            runs: 0,
            itemsChecked: 0,
            itemsFlagged: 0,
          }),
          ai: expect.objectContaining({
            generated: 0,
            failed: 0,
            avgDuration: null,
          }),
          retriesTotal: 0,
          stalledTotal: 0,
          claimFailuresTotal: 0,
        }),
      }),
    );
  });

  it('alerts on stale RECEIVED webhooks and stale DLQ', async () => {
    const { service } = build({
      counts: { staleReceivedWebhooks: 3 },
      queueSnapshot: {
        available: true,
        whatsappInbound: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        followupScheduler: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        dlq: { depth: 2, oldestAgeMs: 3_600_000 },
        dlqWhatsappInbound: 2,
        processingDurationP95Ms: 12,
        retriesTotal: 1,
        stalledTotal: 0,
        claimFailuresTotal: 0,
      },
    });

    const result = await service.getAlerts(actor);
    const codes = result.alerts.map((a) => a.code);
    expect(codes).toContain('WEBHOOK_EVENT_STALE');
    expect(codes).toContain('QUEUE_DLQ_DEPTH');
    expect(codes).toContain('QUEUE_DLQ_STALE');
  });

  it('alerts FOLLOWUP_BACKLOG_HIGH and FOLLOWUP_STUCK_EXECUTING', async () => {
    const { service } = build({
      counts: { executingStale: 2 },
      queueSnapshot: {
        available: true,
        whatsappInbound: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        followupScheduler: {
          waiting: 120,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        reconcileWorker: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        aiSuggestions: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        dlq: { depth: 0, oldestAgeMs: null },
        dlqWhatsappInbound: 0,
        processingDurationP95Ms: null,
        retriesTotal: 0,
        stalledTotal: 0,
        claimFailuresTotal: 0,
        reconcile: {
          runs: 0,
          durationMs: null,
          itemsChecked: 0,
          itemsFlagged: 0,
        },
        ai: { generated: 0, failed: 0, avgDuration: null },
      },
    });

    const result = await service.getAlerts(actor);
    const codes = result.alerts.map((a) => a.code);
    expect(codes).toContain('FOLLOWUP_BACKLOG_HIGH');
    expect(codes).toContain('FOLLOWUP_STUCK_EXECUTING');
    expect(codes).toContain('EXECUTING_FOLLOWUPS_STALE');
  });

  it('alerts AI_QUEUE_BACKLOG_HIGH and AI_GENERATION_FAILURE_RATE', async () => {
    const { service } = build({
      queueSnapshot: {
        available: true,
        whatsappInbound: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        followupScheduler: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        reconcileWorker: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        aiSuggestions: {
          waiting: 80,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        outbound: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          sent: 0,
          failures: 0,
          avgDuration: null,
        },
        dlq: { depth: 0, oldestAgeMs: null },
        dlqWhatsappInbound: 0,
        processingDurationP95Ms: null,
        retriesTotal: 0,
        stalledTotal: 0,
        claimFailuresTotal: 0,
        reconcile: {
          runs: 0,
          durationMs: null,
          itemsChecked: 0,
          itemsFlagged: 0,
        },
        ai: { generated: 4, failed: 8, avgDuration: 1200 },
      },
    });

    const result = await service.getAlerts(actor);
    const codes = result.alerts.map((a) => a.code);
    expect(codes).toContain('AI_QUEUE_BACKLOG_HIGH');
    expect(codes).toContain('AI_GENERATION_FAILURE_RATE');
  });

  it('alerts OUTBOUND_QUEUE_BACKLOG_HIGH and OUTBOUND_FAILURE_RATE (8C)', async () => {
    const { service } = build({
      queueSnapshot: {
        available: true,
        whatsappInbound: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        followupScheduler: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        reconcileWorker: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        aiSuggestions: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        outbound: {
          waiting: 120,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          sent: 2,
          failures: 10,
          avgDuration: 400,
        },
        dlq: { depth: 0, oldestAgeMs: null },
        dlqWhatsappInbound: 0,
        processingDurationP95Ms: null,
        retriesTotal: 0,
        stalledTotal: 0,
        claimFailuresTotal: 0,
        reconcile: {
          runs: 0,
          durationMs: null,
          itemsChecked: 0,
          itemsFlagged: 0,
        },
        ai: { generated: 0, failed: 0, avgDuration: null },
      },
    });

    const result = await service.getAlerts(actor);
    const codes = result.alerts.map((a) => a.code);
    expect(codes).toContain('OUTBOUND_QUEUE_BACKLOG_HIGH');
    expect(codes).toContain('OUTBOUND_FAILURE_RATE');
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

  it('alerts SLOW_QUERY and FULL_TABLE_SCAN (8B)', async () => {
    const { service } = build({
      prom: {
        getHttpWindowStats: () => ({
          total: 0,
          errors5xx: 0,
          errorRate: 0,
          p95Ms: null,
        }),
        getPrismaSlowWindowStats: () => ({ count: 8, thresholdMs: 500 }),
      },
      seqScanRows: [
        {
          relname: 'messages',
          seq_scan: BigInt(5_000),
          idx_scan: BigInt(10),
        },
      ],
    });

    const result = await service.getAlerts(actor);
    const codes = result.alerts.map((a) => a.code);
    expect(codes).toContain('SLOW_QUERY');
    expect(codes).toContain('FULL_TABLE_SCAN');
    const slow = result.alerts.find((a) => a.code === 'SLOW_QUERY');
    expect(slow?.count).toBe(8);
    const scan = result.alerts.find((a) => a.code === 'FULL_TABLE_SCAN');
    expect(scan?.count).toBe(1);
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
      expect.objectContaining({ available: true, dlqWhatsappInbound: 0 }),
    );
    expect(health.timestamp).toBeDefined();
  });

  it('health returns degraded when queue metrics unavailable', async () => {
    const { service } = build({ redisOk: false });
    const health = await service.getHealth(actor);
    expect(health.status).toBe('degraded');
    expect(health.queues).toEqual(
      expect.objectContaining({ available: false }),
    );
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
