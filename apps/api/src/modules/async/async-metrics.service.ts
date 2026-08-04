import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_AI_SUGGESTIONS,
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

export type AiMetrics = {
  generated: number;
  failed: number;
  avgDuration: number | null;
};

export type QueueMetricsSnapshot = {
  /** false when Redis/Bull collection failed — never invent zeros. */
  available: boolean;
  error?: string;
  whatsappInbound: QueueCounts | null;
  followupScheduler: QueueCounts | null;
  reconcileWorker: QueueCounts | null;
  aiSuggestions: QueueCounts | null;
  dlq: DlqMetrics | null;
  /** Back-compat depth mirror; null when unavailable. */
  dlqWhatsappInbound: number | null;
  processingDurationP95Ms: number | null;
  retriesTotal: number;
  stalledTotal: number;
  claimFailuresTotal: number;
  reconcile: ReconcileMetrics;
  ai: AiMetrics;
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
  private aiGenerated = 0;
  private aiFailed = 0;
  private aiDurationSumMs = 0;
  private aiDurationSamples = 0;

  constructor(
    @InjectQueue(QUEUE_WHATSAPP_INBOUND)
    private readonly inbound: Queue,
    @InjectQueue(QUEUE_DLQ_WHATSAPP_INBOUND)
    private readonly dlqQueue: Queue,
    @InjectQueue(QUEUE_FOLLOWUP_SCHEDULER)
    private readonly followupScheduler: Queue,
    @InjectQueue(QUEUE_RECONCILE_WORKER)
    private readonly reconcileWorker: Queue,
    @InjectQueue(QUEUE_AI_SUGGESTIONS)
    private readonly aiSuggestions: Queue,
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

  recordAiGenerated(durationMs: number): void {
    this.aiGenerated += 1;
    this.aiDurationSumMs += durationMs;
    this.aiDurationSamples += 1;
  }

  recordAiFailed(): void {
    this.aiFailed += 1;
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
      ai: {
        generated: this.aiGenerated,
        failed: this.aiFailed,
        avgDuration:
          this.aiDurationSamples > 0
            ? Math.round(this.aiDurationSumMs / this.aiDurationSamples)
            : null,
      } satisfies AiMetrics,
    };

    try {
      await this.dlq.cleanup();
      const [
        inboundCounts,
        followupCounts,
        reconcileCounts,
        aiCounts,
        dlqMetrics,
      ] = await Promise.all([
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
        this.aiSuggestions.getJobCounts(
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
        aiSuggestions: toCounts(aiCounts),
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
        aiSuggestions: null,
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
