import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  QUEUE_DLQ_MAX_JOBS_DEFAULT,
  QUEUE_DLQ_RETENTION_MS_DEFAULT,
  QUEUE_DLQ_WHATSAPP_INBOUND,
  QUEUE_WHATSAPP_INBOUND,
} from './async.constants';
import type { DlqJobPayload, WhatsappInboundJobPayload } from './async.types';
import type { DlqMetrics } from './async-metrics.service';

/**
 * DLQ governance (7.1-H) — max jobs, retention, auto cleanup.
 * Replay Ops API remains out of scope.
 */
@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);
  private readonly maxJobs: number;
  private readonly retentionMs: number;
  private cleanupInFlight: Promise<void> | null = null;

  constructor(
    @InjectQueue(QUEUE_DLQ_WHATSAPP_INBOUND)
    private readonly dlq: Queue<DlqJobPayload>,
    config: ConfigService,
  ) {
    this.maxJobs = config.get<number>(
      'async.dlqMaxJobs',
      QUEUE_DLQ_MAX_JOBS_DEFAULT,
    );
    this.retentionMs = config.get<number>(
      'async.dlqRetentionMs',
      QUEUE_DLQ_RETENTION_MS_DEFAULT,
    );
  }

  async moveWhatsappInboundToDlq(input: {
    originalJobId: string;
    failedReason: string;
    payload: WhatsappInboundJobPayload;
    attemptsMade: number;
  }): Promise<void> {
    const body: DlqJobPayload = {
      v: 1,
      originalQueue: QUEUE_WHATSAPP_INBOUND,
      originalJobId: input.originalJobId,
      failedReason: input.failedReason.slice(0, 1000),
      payload: input.payload,
      correlationId: input.payload.correlationId,
      failedAt: new Date().toISOString(),
      attemptsMade: input.attemptsMade,
    };

    await this.dlq.add('dead-letter', body, {
      jobId: `dlq:${input.originalJobId}`,
      removeOnComplete: false,
      removeOnFail: false,
    });

    this.logger.warn(
      `DLQ inbound jobId=${input.originalJobId} correlationId=${input.payload.correlationId} reason=${body.failedReason}`,
    );

    await this.cleanup();
  }

  async getDepth(): Promise<number> {
    const counts = await this.dlq.getJobCounts(
      'waiting',
      'delayed',
      'failed',
      'paused',
    );
    return (
      (counts.waiting ?? 0) +
      (counts.delayed ?? 0) +
      (counts.failed ?? 0) +
      (counts.paused ?? 0)
    );
  }

  async getMetrics(): Promise<DlqMetrics> {
    const jobs = await this.dlq.getJobs(
      ['waiting', 'delayed', 'failed', 'paused'],
      0,
      Math.max(this.maxJobs * 2, 200),
      true,
    );
    const depth = jobs.length;
    let oldestTs: number | null = null;
    for (const job of jobs) {
      const ts = job.timestamp ?? 0;
      if (ts > 0 && (oldestTs === null || ts < oldestTs)) {
        oldestTs = ts;
      }
    }
    return {
      depth,
      oldestAgeMs:
        oldestTs === null ? null : Math.max(0, Date.now() - oldestTs),
    };
  }

  /** Age-based + max-depth cleanup (best-effort, serialized). */
  async cleanup(): Promise<void> {
    if (this.cleanupInFlight) {
      return this.cleanupInFlight;
    }
    this.cleanupInFlight = this.runCleanup().finally(() => {
      this.cleanupInFlight = null;
    });
    return this.cleanupInFlight;
  }

  private async runCleanup(): Promise<void> {
    try {
      // BullMQ clean grace is milliseconds.
      const graceMs = Math.max(1, this.retentionMs);
      await this.dlq.clean(graceMs, 500, 'completed');
      await this.dlq.clean(graceMs, 500, 'failed');
      await this.dlq.clean(graceMs, 500, 'wait');

      const jobs = await this.dlq.getJobs(
        ['waiting', 'delayed', 'failed', 'paused'],
        0,
        this.maxJobs + 200,
        true,
      );

      const cutoff = Date.now() - this.retentionMs;
      const expired = jobs.filter(
        (j) => (j.timestamp ?? 0) > 0 && (j.timestamp ?? 0) < cutoff,
      );
      for (const job of expired) {
        await job.remove().catch(() => undefined);
      }

      const expiredIds = new Set(expired.map((j) => j.id));
      const remaining = jobs
        .filter((j) => !expiredIds.has(j.id))
        .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

      const overflow = remaining.length - this.maxJobs;
      if (overflow > 0) {
        for (const job of remaining.slice(0, overflow)) {
          await job.remove().catch(() => undefined);
        }
        this.logger.warn(
          `DLQ trimmed overflow=${overflow} maxJobs=${this.maxJobs}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `DLQ cleanup failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Used by graceful shutdown. */
  async close(): Promise<void> {
    await this.dlq.close();
  }
}
