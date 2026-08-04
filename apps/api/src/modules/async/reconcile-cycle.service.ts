import { Injectable, Logger } from '@nestjs/common';
import {
  CompanyStatus,
  FollowUpStatus,
  MembershipRole,
  WebhookEventStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithRlsBypassAsync } from '../../prisma/rls-context';
import { runWithRequestContextAsync } from '../../observability/request-context';
import { AuditService } from '../audit/audit.service';
import { OpsService } from '../ops/ops.service';
import { OPS_STALE_MS } from '../ops/ops.constants';
import { OUTBOUND_MESSAGE_STATUS } from '../whatsapp/outbound/message-status';
import { AsyncMetricsService } from './async-metrics.service';
import type { ReconcileCycleJobPayload } from './async.types';

export type ReconcileCycleResult = {
  correlationId: string;
  companiesProcessed: number;
  itemsChecked: number;
  itemsFlagged: number;
  messagesTimedOut: number;
  followUpsSuspected: number;
  staleWebhooks: number;
  dlqDepth: number | null;
  oldestDlqAgeMs: number | null;
  durationMs: number;
};

type SystemActor = {
  sub: string;
  sid: string;
  cid: string;
  mid: string;
  role: MembershipRole;
};

/**
 * 7.2B — one reconcile cycle:
 * - PENDING messages >5m → Ops reconcileMessages(apply) (orphan timeout)
 * - EXECUTING follow-ups >5m → mark suspect in metadata (no EXECUTED change)
 * - RECEIVED webhooks >5m → count only (no replay)
 * - DLQ depth/age → metrics (alerts via Ops)
 */
@Injectable()
export class ReconcileCycleService {
  private readonly logger = new Logger(ReconcileCycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ops: OpsService,
    private readonly metrics: AsyncMetricsService,
  ) {}

  async runCycle(job: ReconcileCycleJobPayload): Promise<ReconcileCycleResult> {
    const started = Date.now();
    const take = Math.max(1, job.take);
    let budget = take;
    let itemsChecked = 0;
    let itemsFlagged = 0;
    let messagesTimedOut = 0;
    let followUpsSuspected = 0;
    let staleWebhooks = 0;
    let companiesProcessed = 0;

    const companyIds = await this.listCompaniesWithStaleSignals(take);
    const staleBefore = new Date(Date.now() - OPS_STALE_MS);

    for (const companyId of companyIds) {
      if (budget <= 0) break;
      companiesProcessed += 1;

      const actor = await this.resolveSystemActor(companyId);
      if (!actor) {
        this.logger.warn(`reconcile skip company=${companyId}: no OWNER actor`);
        continue;
      }

      await runWithRequestContextAsync({ companyId }, async () => {
        // 1) Messages PENDING stale — Ops PENDING_TIMEOUT (echo heal needs inbound).
        if (budget > 0) {
          const msgResult = await this.ops.reconcileMessages(
            actor,
            true,
            undefined,
            budget,
          );
          itemsChecked += msgResult.encontrados;
          messagesTimedOut += msgResult.corrigidos;
          itemsFlagged += msgResult.corrigidos;
          budget -= msgResult.encontrados;
        }

        // 2) FollowUps EXECUTING stale — mark suspect only (never touch EXECUTED).
        if (budget > 0) {
          const stuck = await this.prisma.followUp.findMany({
            where: {
              companyId,
              deletedAt: null,
              status: FollowUpStatus.EXECUTING,
              updatedAt: { lt: staleBefore },
            },
            select: { id: true, metadata: true },
            take: budget,
            orderBy: { updatedAt: 'asc' },
          });
          itemsChecked += stuck.length;
          for (const fu of stuck) {
            const flagged = await this.flagFollowUpSuspect(companyId, fu);
            if (flagged) {
              followUpsSuspected += 1;
              itemsFlagged += 1;
            }
          }
          budget -= stuck.length;
        }

        // 3) WebhookEvents RECEIVED stale — detect only (no replay).
        if (budget > 0) {
          const webhooks = await this.prisma.webhookEvent.findMany({
            where: {
              companyId,
              deletedAt: null,
              status: WebhookEventStatus.RECEIVED,
              receivedAt: { lt: staleBefore },
            },
            select: { id: true },
            take: budget,
            orderBy: { receivedAt: 'asc' },
          });
          itemsChecked += webhooks.length;
          staleWebhooks += webhooks.length;
          // Flagged for metrics/alerts — no mutation / no replay.
          itemsFlagged += webhooks.length;
          budget -= webhooks.length;
        }
      });
    }

    const queues = await this.metrics.snapshot();
    const durationMs = Date.now() - started;
    this.metrics.recordReconcileRun({
      durationMs,
      itemsChecked,
      itemsFlagged,
    });

    const result: ReconcileCycleResult = {
      correlationId: job.correlationId,
      companiesProcessed,
      itemsChecked,
      itemsFlagged,
      messagesTimedOut,
      followUpsSuspected,
      staleWebhooks,
      dlqDepth: queues.dlqWhatsappInbound,
      oldestDlqAgeMs: queues.dlq?.oldestAgeMs ?? null,
      durationMs,
    };

    this.logger.log(
      `reconcile cycle done correlationId=${job.correlationId} checked=${itemsChecked} flagged=${itemsFlagged} durationMs=${durationMs}`,
    );
    return result;
  }

  private async listCompaniesWithStaleSignals(
    limit: number,
  ): Promise<string[]> {
    const staleBefore = new Date(Date.now() - OPS_STALE_MS);
    const [fromMessages, fromFollowUps, fromWebhooks, activeCompanies] =
      await runWithRlsBypassAsync(() =>
        Promise.all([
          this.prisma.message.findMany({
            where: {
              deletedAt: null,
              status: OUTBOUND_MESSAGE_STATUS.PENDING,
              createdAt: { lt: staleBefore },
            },
            select: { companyId: true },
            distinct: ['companyId'],
            take: limit,
          }),
          this.prisma.followUp.findMany({
            where: {
              deletedAt: null,
              status: FollowUpStatus.EXECUTING,
              updatedAt: { lt: staleBefore },
            },
            select: { companyId: true },
            distinct: ['companyId'],
            take: limit,
          }),
          this.prisma.webhookEvent.findMany({
            where: {
              deletedAt: null,
              status: WebhookEventStatus.RECEIVED,
              receivedAt: { lt: staleBefore },
            },
            select: { companyId: true },
            distinct: ['companyId'],
            take: limit,
          }),
          this.prisma.company.findMany({
            where: { deletedAt: null, status: CompanyStatus.ACTIVE },
            select: { id: true },
            take: limit,
            orderBy: { createdAt: 'asc' },
          }),
        ]),
      );

    const ids = new Set<string>();
    for (const row of fromMessages) ids.add(row.companyId);
    for (const row of fromFollowUps) ids.add(row.companyId);
    for (const row of fromWebhooks) ids.add(row.companyId);
    // Always include a slice of active companies so DLQ/metrics path runs even
    // when no stale rows (bounded — no infinite loop).
    for (const c of activeCompanies) {
      if (ids.size >= limit) break;
      ids.add(c.id);
    }
    return [...ids].slice(0, limit);
  }

  private async flagFollowUpSuspect(
    companyId: string,
    fu: { id: string; metadata: unknown },
  ): Promise<boolean> {
    const prevMeta =
      fu.metadata &&
      typeof fu.metadata === 'object' &&
      !Array.isArray(fu.metadata)
        ? (fu.metadata as Record<string, unknown>)
        : {};

    if (prevMeta.reconcileSuspect === true) {
      return false;
    }

    const updated = await this.prisma.followUp.updateMany({
      where: {
        id: fu.id,
        companyId,
        status: FollowUpStatus.EXECUTING,
        deletedAt: null,
      },
      data: {
        metadata: {
          ...prevMeta,
          reconcileSuspect: true,
          reconcileSuspectedAt: new Date().toISOString(),
        },
      },
    });

    if (updated.count !== 1) return false;

    await this.prisma.$transaction(async (tx) => {
      await this.audit.write(tx, {
        companyId,
        actorUserId: null,
        action: 'OPS_RECONCILE_FOLLOWUP_SUSPECT',
        targetType: 'FOLLOWUP',
        targetId: fu.id,
        before: { status: FollowUpStatus.EXECUTING },
        after: {
          status: FollowUpStatus.EXECUTING,
          reconcileSuspect: true,
        },
      });
    });

    return true;
  }

  private async resolveSystemActor(
    companyId: string,
  ): Promise<SystemActor | null> {
    const owner = await this.prisma.membership.findFirst({
      where: {
        companyId,
        role: MembershipRole.OWNER,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, userId: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) return null;
    return {
      sub: owner.userId,
      sid: 'reconcile-worker',
      cid: companyId,
      mid: owner.id,
      role: owner.role,
    };
  }
}
