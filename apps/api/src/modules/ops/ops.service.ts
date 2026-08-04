import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FollowUpStatus,
  Prisma,
  WebhookEventStatus,
  WhatsAppConnectionStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { EvolutionClient } from '../whatsapp/evolution.client';
import { OUTBOUND_MESSAGE_STATUS } from '../whatsapp/outbound/message-status';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';
import { ListWebhooksQueryDto } from './dto/list-webhooks.query.dto';
import { OPS_RECONCILE_TAKE_DEFAULT, OPS_STALE_MS } from './ops.constants';
import { pingRedis } from './redis-ping';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

export type OpsMetrics = {
  whatsappConnected: boolean;
  totalMessages: number;
  pendingMessages: number;
  failedMessages: number;
  scheduledFollowUps: number;
  overdueFollowUps: number;
  executedFollowUps: number;
  evolutionCircuitState: string;
  evolutionTimeoutsLast15m: number;
  evolutionRetriesTotal: number;
  webhookP95Ms: number | null;
  webhookSlowLast15m: number;
  webhookInflight: number;
};

export type OpsAlert = {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  count?: number;
};

export type ReconcileResult = {
  apply: boolean;
  encontrados: number;
  corrigidos: number;
  ignorados: number;
};

@Injectable()
export class OpsService {
  private readonly reconcileTake: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly evolution: EvolutionClient,
  ) {
    this.reconcileTake = config.get<number>(
      'ops.reconcileTake',
      OPS_RECONCILE_TAKE_DEFAULT,
    );
  }

  async getOverview(actor: CompanyActor) {
    const [metrics, alerts] = await Promise.all([
      this.getMetrics(actor),
      this.getAlerts(actor),
    ]);

    return {
      companyId: actor.cid,
      generatedAt: new Date().toISOString(),
      metrics,
      alerts,
    };
  }

  async getMetrics(actor: CompanyActor): Promise<OpsMetrics> {
    const companyId = actor.cid;
    const now = new Date();

    const [
      instance,
      totalMessages,
      pendingMessages,
      failedMessages,
      scheduledFollowUps,
      overdueFollowUps,
      executedFollowUps,
    ] = await Promise.all([
      this.prisma.whatsAppInstance.findFirst({
        where: { companyId, deletedAt: null },
        select: { status: true },
      }),
      this.prisma.message.count({
        where: { companyId, deletedAt: null },
      }),
      this.prisma.message.count({
        where: {
          companyId,
          deletedAt: null,
          status: OUTBOUND_MESSAGE_STATUS.PENDING,
        },
      }),
      this.prisma.message.count({
        where: {
          companyId,
          deletedAt: null,
          status: OUTBOUND_MESSAGE_STATUS.FAILED,
        },
      }),
      this.prisma.followUp.count({
        where: {
          companyId,
          deletedAt: null,
          status: FollowUpStatus.SCHEDULED,
        },
      }),
      this.prisma.followUp.count({
        where: {
          companyId,
          deletedAt: null,
          status: {
            in: [FollowUpStatus.APPROVED, FollowUpStatus.SCHEDULED],
          },
          scheduledAt: { lt: now, not: null },
        },
      }),
      this.prisma.followUp.count({
        where: {
          companyId,
          deletedAt: null,
          status: FollowUpStatus.EXECUTED,
        },
      }),
    ]);

    const channel = this.evolution.getMetricsSnapshot();

    return {
      whatsappConnected:
        instance?.status === WhatsAppConnectionStatus.CONNECTED,
      totalMessages,
      pendingMessages,
      failedMessages,
      scheduledFollowUps,
      overdueFollowUps,
      executedFollowUps,
      evolutionCircuitState: channel.evolutionCircuitState,
      evolutionTimeoutsLast15m: channel.evolutionTimeoutsLast15m,
      evolutionRetriesTotal: channel.evolutionRetriesTotal,
      webhookP95Ms: channel.webhookP95Ms,
      webhookSlowLast15m: channel.webhookSlowLast15m,
      webhookInflight: channel.webhookInflight,
    };
  }

  async getAlerts(actor: CompanyActor): Promise<{
    companyId: string;
    generatedAt: string;
    alerts: OpsAlert[];
  }> {
    const companyId = actor.cid;
    const metrics = await this.getMetrics(actor);
    const staleBefore = new Date(Date.now() - OPS_STALE_MS);

    const [pendingStale, executingStale, webhookFailedRecent] =
      await Promise.all([
        this.prisma.message.count({
          where: {
            companyId,
            deletedAt: null,
            status: OUTBOUND_MESSAGE_STATUS.PENDING,
            createdAt: { lt: staleBefore },
          },
        }),
        this.prisma.followUp.count({
          where: {
            companyId,
            deletedAt: null,
            status: FollowUpStatus.EXECUTING,
            updatedAt: { lt: staleBefore },
          },
        }),
        this.prisma.webhookEvent.count({
          where: {
            companyId,
            deletedAt: null,
            status: WebhookEventStatus.FAILED,
            receivedAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
          },
        }),
      ]);

    const alerts: OpsAlert[] = [];

    if (!metrics.whatsappConnected) {
      alerts.push({
        code: 'WHATSAPP_NOT_CONNECTED',
        severity: 'error',
        message: 'WhatsApp instance is not CONNECTED',
      });
    }

    if (pendingStale > 0) {
      alerts.push({
        code: 'PENDING_MESSAGES_STALE',
        severity: 'warning',
        message: 'Outbound messages PENDING for more than 5 minutes',
        count: pendingStale,
      });
    }

    if (executingStale > 0) {
      alerts.push({
        code: 'EXECUTING_FOLLOWUPS_STALE',
        severity: 'warning',
        message: 'Follow-ups EXECUTING for more than 5 minutes',
        count: executingStale,
      });
    }

    if (metrics.failedMessages > 0) {
      alerts.push({
        code: 'FAILED_MESSAGES',
        severity: 'warning',
        message: 'There are FAILED outbound messages',
        count: metrics.failedMessages,
      });
    }

    if (metrics.overdueFollowUps > 0) {
      alerts.push({
        code: 'OVERDUE_FOLLOWUPS',
        severity: 'warning',
        message: 'There are overdue follow-ups',
        count: metrics.overdueFollowUps,
      });
    }

    if (webhookFailedRecent > 0) {
      alerts.push({
        code: 'WEBHOOK_FAILURES_RECENT',
        severity: 'warning',
        message: 'Webhook events FAILED in the last 15 minutes',
        count: webhookFailedRecent,
      });
    }

    if (metrics.evolutionCircuitState === 'OPEN') {
      alerts.push({
        code: 'EVOLUTION_CIRCUIT_OPEN',
        severity: 'error',
        message: 'Evolution circuit breaker is OPEN',
      });
    }

    if (metrics.evolutionTimeoutsLast15m >= 5) {
      alerts.push({
        code: 'EVOLUTION_HIGH_TIMEOUT_RATE',
        severity: 'warning',
        message: 'High Evolution timeout rate in the last 15 minutes',
        count: metrics.evolutionTimeoutsLast15m,
      });
    }

    if (metrics.webhookSlowLast15m > 0) {
      alerts.push({
        code: 'WEBHOOK_SLOW',
        severity: 'warning',
        message: 'Slow webhook processing detected in the last 15 minutes',
        count: metrics.webhookSlowLast15m,
      });
    }

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      alerts,
    };
  }

  async getHealth(actor: CompanyActor) {
    const companyId = actor.cid;
    const channel = this.evolution.getMetricsSnapshot();

    const [postgres, redis, whatsapp] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkWhatsapp(companyId),
    ]);

    let status: 'ok' | 'degraded' | 'error' = 'ok';
    if (postgres === 'down') {
      status = 'error';
    } else if (
      redis === 'down' ||
      whatsapp === 'down' ||
      channel.evolutionCircuitState === 'OPEN'
    ) {
      status = 'degraded';
    }

    return {
      status,
      postgres,
      redis,
      whatsapp,
      evolution: {
        circuit: channel.evolutionCircuitState,
        lastErrorAt: channel.evolutionLastErrorAt,
        stubMode: this.evolution.isStubMode(),
      },
      timestamp: new Date().toISOString(),
    };
  }

  async listAudit(actor: CompanyActor, query: ListAuditQueryDto) {
    const companyId = actor.cid;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AuditLogWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.action) where.action = query.action;
    if (query.actorUserId) where.actorUserId = query.actorUserId;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;

    if (query.from || query.to) {
      where.occurredAt = {};
      if (query.from) where.occurredAt.gte = query.from;
      if (query.to) where.occurredAt.lte = query.to;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          companyId: true,
          actorType: true,
          actorUserId: true,
          action: true,
          targetType: true,
          targetId: true,
          occurredAt: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async getAudit(actor: CompanyActor, id: string) {
    const row = await this.prisma.auditLog.findFirst({
      where: { id, companyId: actor.cid, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException('Audit log not found');
    }
    return row;
  }

  async listWebhooks(actor: CompanyActor, query: ListWebhooksQueryDto) {
    const companyId = actor.cid;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.WebhookEventWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.eventType) where.eventType = query.eventType;

    if (query.from || query.to) {
      where.receivedAt = {};
      if (query.from) where.receivedAt.gte = query.from;
      if (query.to) where.receivedAt.lte = query.to;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.webhookEvent.count({ where }),
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          companyId: true,
          instanceId: true,
          externalEventId: true,
          eventType: true,
          status: true,
          error: true,
          receivedAt: true,
          processedAt: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async getWebhook(actor: CompanyActor, id: string) {
    const row = await this.prisma.webhookEvent.findFirst({
      where: { id, companyId: actor.cid, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException('Webhook event not found');
    }

    return {
      ...row,
      payload: this.redactPayload(row.payload),
    };
  }

  async reconcileMessages(
    actor: CompanyActor,
    apply: boolean,
    meta?: RequestMeta,
  ): Promise<ReconcileResult> {
    const companyId = actor.cid;
    const staleBefore = new Date(Date.now() - OPS_STALE_MS);

    const matched = await this.prisma.message.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: OUTBOUND_MESSAGE_STATUS.PENDING,
        createdAt: { lt: staleBefore },
      },
      select: { id: true, status: true },
      take: this.reconcileTake,
      orderBy: { createdAt: 'asc' },
    });

    const encontrados = matched.length;
    if (!apply || encontrados === 0) {
      return {
        apply,
        encontrados,
        corrigidos: 0,
        ignorados: encontrados,
      };
    }

    const now = new Date();
    let corrigidos = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const msg of matched) {
        const updated = await tx.message.updateMany({
          where: {
            id: msg.id,
            companyId,
            status: OUTBOUND_MESSAGE_STATUS.PENDING,
            deletedAt: null,
          },
          data: {
            status: OUTBOUND_MESSAGE_STATUS.FAILED,
            failedAt: now,
            errorMessage: 'PENDING_TIMEOUT',
          },
        });
        if (updated.count === 1) {
          corrigidos += 1;
          await this.audit.write(tx, {
            companyId,
            actorUserId: actor.sub,
            action: 'OPS_RECONCILE_MESSAGES',
            targetType: 'MESSAGE',
            targetId: msg.id,
            before: { status: OUTBOUND_MESSAGE_STATUS.PENDING },
            after: {
              status: OUTBOUND_MESSAGE_STATUS.FAILED,
              errorMessage: 'PENDING_TIMEOUT',
            },
            ip: meta?.ip,
            userAgent: meta?.userAgent,
          });
        }
      }
    });

    return {
      apply: true,
      encontrados,
      corrigidos,
      ignorados: encontrados - corrigidos,
    };
  }

  async reconcileFollowUps(
    actor: CompanyActor,
    apply: boolean,
    meta?: RequestMeta,
  ): Promise<ReconcileResult> {
    const companyId = actor.cid;
    const staleBefore = new Date(Date.now() - OPS_STALE_MS);

    const matched = await this.prisma.followUp.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: FollowUpStatus.EXECUTING,
        updatedAt: { lt: staleBefore },
      },
      select: { id: true, status: true, metadata: true },
      take: this.reconcileTake,
      orderBy: { updatedAt: 'asc' },
    });

    const encontrados = matched.length;
    if (!apply || encontrados === 0) {
      return {
        apply,
        encontrados,
        corrigidos: 0,
        ignorados: encontrados,
      };
    }

    let corrigidos = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const fu of matched) {
        const prevMeta =
          fu.metadata &&
          typeof fu.metadata === 'object' &&
          !Array.isArray(fu.metadata)
            ? (fu.metadata as Record<string, unknown>)
            : {};

        const updated = await tx.followUp.updateMany({
          where: {
            id: fu.id,
            companyId,
            status: FollowUpStatus.EXECUTING,
            deletedAt: null,
          },
          data: {
            status: FollowUpStatus.FAILED,
            cancelReason: 'EXECUTING_TIMEOUT',
            metadata: {
              ...prevMeta,
              lastError: 'EXECUTING_TIMEOUT',
              executingTimedOutAt: new Date().toISOString(),
            },
          },
        });

        if (updated.count === 1) {
          corrigidos += 1;
          await this.audit.write(tx, {
            companyId,
            actorUserId: actor.sub,
            action: 'OPS_RECONCILE_FOLLOWUPS',
            targetType: 'FOLLOWUP',
            targetId: fu.id,
            before: { status: FollowUpStatus.EXECUTING },
            after: {
              status: FollowUpStatus.FAILED,
              cancelReason: 'EXECUTING_TIMEOUT',
            },
            ip: meta?.ip,
            userAgent: meta?.userAgent,
          });
        }
      }
    });

    return {
      apply: true,
      encontrados,
      corrigidos,
      ignorados: encontrados - corrigidos,
    };
  }

  private async checkPostgres(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<'up' | 'down'> {
    const host = this.config.get<string>('redis.host', 'localhost');
    const port = this.config.get<number>('redis.port', 6379);
    const password = this.config.get<string>('redis.password') || undefined;
    const ok = await pingRedis({ host, port, password });
    return ok ? 'up' : 'down';
  }

  private async checkWhatsapp(companyId: string): Promise<'up' | 'down'> {
    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { companyId, deletedAt: null },
      select: { status: true },
    });
    if (!instance) return 'down';
    return instance.status === WhatsAppConnectionStatus.CONNECTED
      ? 'up'
      : 'down';
  }

  private redactPayload(payload: Prisma.JsonValue): Prisma.JsonValue {
    if (payload === null || payload === undefined) return payload;
    try {
      const raw = JSON.stringify(payload);
      if (raw.length <= 20_000) return payload;
      return {
        truncated: true,
        preview: raw.slice(0, 20_000),
      };
    } catch {
      return { truncated: true, error: 'UNSERIALIZABLE_PAYLOAD' };
    }
  }
}
