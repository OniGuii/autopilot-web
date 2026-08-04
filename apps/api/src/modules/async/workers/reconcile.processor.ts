import {
  BeforeApplicationShutdown,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { AsyncMetricsService } from '../async-metrics.service';
import {
  ASYNC_LOCK_DURATION_MS_DEFAULT,
  QUEUE_RECONCILE_WORKER,
  RECONCILE_ATTEMPTS_DEFAULT,
  resolveReconcileConcurrency,
} from '../async.constants';
import type { ReconcileCycleJobPayload } from '../async.types';
import { ReconcileCycleService } from '../reconcile-cycle.service';

@Processor(QUEUE_RECONCILE_WORKER, {
  concurrency: resolveReconcileConcurrency(),
  lockDuration: ASYNC_LOCK_DURATION_MS_DEFAULT,
})
export class ReconcileProcessor
  extends WorkerHost
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(ReconcileProcessor.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly cycle: ReconcileCycleService,
    private readonly metrics: AsyncMetricsService,
    config: ConfigService,
  ) {
    super();
    this.maxAttempts = config.get<number>(
      'async.reconcileAttempts',
      RECONCILE_ATTEMPTS_DEFAULT,
    );
  }

  onModuleInit(): void {
    this.logger.log(
      `reconcile-worker ready concurrency=${resolveReconcileConcurrency()}`,
    );
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`reconcile-worker shutdown signal=${signal ?? 'unknown'}`);
    try {
      if (this.worker) {
        await this.worker.close();
      }
    } catch (err) {
      this.logger.warn(
        `reconcile worker close failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async process(job: Job<ReconcileCycleJobPayload>): Promise<{
    ok: true;
    result: Awaited<ReturnType<ReconcileCycleService['runCycle']>>;
  }> {
    const started = Date.now();
    this.logger.debug(
      `process reconcile jobId=${job.id} correlationId=${job.data.correlationId}`,
    );
    try {
      const result = await this.cycle.runCycle(job.data);
      return { ok: true, result };
    } finally {
      this.metrics.recordProcessingDuration(Date.now() - started);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ReconcileCycleJobPayload> | undefined, error: Error): void {
    if (!job) return;
    const attempts = job.opts.attempts ?? this.maxAttempts;
    if (job.attemptsMade < attempts) {
      this.metrics.recordRetry();
      this.logger.warn(
        `reconcile retry jobId=${job.id} attempt=${job.attemptsMade}/${attempts} err=${error.message}`,
      );
      return;
    }
    this.logger.error(
      `reconcile failed final jobId=${job.id} err=${error.message}`,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.metrics.recordStalled();
    this.logger.warn(`reconcile stalled jobId=${jobId}`);
  }
}
