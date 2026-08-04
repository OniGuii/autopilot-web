import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_DLQ_WHATSAPP_INBOUND,
  QUEUE_FOLLOWUP_SCHEDULER,
  QUEUE_RECONCILE_WORKER,
  QUEUE_WHATSAPP_INBOUND,
} from './async.constants';
import { DlqService } from './dlq.service';

const DURATION_WINDOW_MS = 15 * 60 * 1000;
const DURATION_MAX_SAMPLES = 2_000;

export type QueueCounts = {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
};

export type DlqMetrics = {
  depth: number;
  oldestAgeMs: number | null;
};

export type ReconcileMetrics = {
  runs: number;
  durationMs: number | null;
  itemsChecked: number;
  itemsFlagged: number;
};

export type QueueMetricsSnapshot = {
  /** false when Redis/Bull collection failed — never invent zeros. */
  available: boolean;
  error?: string;
  whatsappInbound: QueueCounts | null;
  followupScheduler: QueueCounts | null;
  reconcileWorker: QueueCounts | null;
  dlq: DlqMetrics | null;
  /** Back-compat depth mirror; null when unavailable. */
  dlqWhatsappInbound: number | null;
  processingDurationP95Ms: number | null;
  retriesTotal: number;
  stalledTotal: number;
  claimFailuresTotal: number;
  reconcile: ReconcileMetrics;
};

/**
 * Bull/Ops metrics + in-process counters.
 * Failures surface as available=false — never mask as zero counts.
 */
@Injectable()
export class AsyncMetricsService {
  private readonly logger = new Logger(AsyncMetricsService.name);
  private retriesTotal = 0;
  private stalledTotal = 0;
  private claimFailuresTotal = 0;
  private durations: { at: number; ms: number }[] = [];
  private reconcileRuns = 0;
  private reconcileItemsChecked = 0;
  private reconcileItemsFlagged = 0;
  private lastReconcileDurationMs: number | null = null;

  constructor(
    @InjectQueue(QUEUE_WHATSAPP_INBOUND)
    private readonly inbound: Queue,
    @InjectQueue(QUEUE_DLQ_WHATSAPP_INBOUND)
    private readonly dlqQueue: Queue,
    @InjectQueue(QUEUE_FOLLOWUP_SCHEDULER)
    private readonly followupScheduler: Queue,
    @InjectQueue(QUEUE_RECONCILE_WORKER)
    private readonly reconcileWorker: Queue,
    private readonly dlq: DlqService,
  ) {}

  recordProcessingDuration(ms: number): void {
    const now = Date.now();
    this.durations.push({ at: now, ms });
    this.trimDurations(now);
  }

  recordRetry(): void {
    this.retriesTotal += 1;
  }

  recordStalled(): void {
    this.stalledTotal += 1;
  }

  recordClaimFailure(): void {
    this.claimFailuresTotal += 1;
  }

  recordReconcileRun(input: {
    durationMs: number;
    itemsChecked: number;
    itemsFlagged: number;
  }): void {
    this.reconcileRuns += 1;
    this.lastReconcileDurationMs = input.durationMs;
    this.reconcileItemsChecked += input.itemsChecked;
    this.reconcileItemsFlagged += input.itemsFlagged;
  }

  async snapshot(): Promise<QueueMetricsSnapshot> {
    const counters = {
      processingDurationP95Ms: this.p95DurationMs(),
      retriesTotal: this.retriesTotal,
      stalledTotal: this.stalledTotal,
      claimFailuresTotal: this.claimFailuresTotal,
      reconcile: {
        runs: this.reconcileRuns,
        durationMs: this.lastReconcileDurationMs,
        itemsChecked: this.reconcileItemsChecked,
        itemsFlagged: this.reconcileItemsFlagged,
      } satisfies ReconcileMetrics,
    };

    try {
      await this.dlq.cleanup();
      const [inboundCounts, followupCounts, reconcileCounts, dlqMetrics] =
        await Promise.all([
          this.inbound.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
          ),
          this.followupScheduler.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
          ),
          this.reconcileWorker.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
          ),
          this.dlq.getMetrics(),
        ]);

      return {
        available: true,
        whatsappInbound: toCounts(inboundCounts),
        followupScheduler: toCounts(followupCounts),
        reconcileWorker: toCounts(reconcileCounts),
        dlq: dlqMetrics,
        dlqWhatsappInbound: dlqMetrics.depth,
        ...counters,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`async metrics unavailable: ${message}`);
      return {
        available: false,
        error: message.slice(0, 500),
        whatsappInbound: null,
        followupScheduler: null,
        reconcileWorker: null,
        dlq: null,
        dlqWhatsappInbound: null,
        ...counters,
      };
    }
  }

  private p95DurationMs(): number | null {
    this.trimDurations(Date.now());
    if (this.durations.length === 0) return null;
    const sorted = this.durations.map((d) => d.ms).sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx] ?? null;
  }

  private trimDurations(now: number): void {
    const cutoff = now - DURATION_WINDOW_MS;
    this.durations = this.durations.filter((d) => d.at >= cutoff);
    if (this.durations.length > DURATION_MAX_SAMPLES) {
      this.durations = this.durations.slice(-DURATION_MAX_SAMPLES);
    }
  }
}

function toCounts(counts: Record<string, number>): QueueCounts {
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}
