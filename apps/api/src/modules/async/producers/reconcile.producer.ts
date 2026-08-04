import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  QUEUE_RECONCILE_WORKER,
  QUEUE_REMOVE_ON_COMPLETE_DEFAULT,
  QUEUE_REMOVE_ON_FAIL_DEFAULT,
  RECONCILE_ATTEMPTS_DEFAULT,
  RECONCILE_BACKOFF_MS_DEFAULT,
  RECONCILE_CYCLE_JOB_NAME,
  RECONCILE_TAKE_DEFAULT,
} from '../async.constants';
import type { ReconcileCycleJobPayload } from '../async.types';

@Injectable()
export class ReconcileProducer {
  private readonly logger = new Logger(ReconcileProducer.name);
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly removeOnComplete: number;
  private readonly removeOnFail: number;
  private readonly take: number;

  constructor(
    @InjectQueue(QUEUE_RECONCILE_WORKER)
    private readonly queue: Queue<ReconcileCycleJobPayload>,
    config: ConfigService,
  ) {
    this.attempts = config.get<number>(
      'async.reconcileAttempts',
      RECONCILE_ATTEMPTS_DEFAULT,
    );
    this.backoffMs = config.get<number>(
      'async.reconcileBackoffMs',
      RECONCILE_BACKOFF_MS_DEFAULT,
    );
    this.removeOnComplete = config.get<number>(
      'async.removeOnComplete',
      QUEUE_REMOVE_ON_COMPLETE_DEFAULT,
    );
    this.removeOnFail = config.get<number>(
      'async.removeOnFail',
      QUEUE_REMOVE_ON_FAIL_DEFAULT,
    );
    this.take = config.get<number>(
      'async.reconcileTake',
      RECONCILE_TAKE_DEFAULT,
    );
  }

  /**
   * Enqueue a reconcile cycle. jobId bucketed by minute to avoid backlog piles.
   */
  async enqueueCycle(
    correlationId: string,
  ): Promise<{ jobId: string; deduped: boolean }> {
    const bucket = Math.floor(Date.now() / 60_000);
    const jobId = `reconcile:cycle:${bucket}`;
    const payload: ReconcileCycleJobPayload = {
      v: 1,
      correlationId,
      trigger: 'schedule',
      take: this.take,
    };

    try {
      const job = await this.queue.add(RECONCILE_CYCLE_JOB_NAME, payload, {
        jobId,
        attempts: this.attempts,
        backoff: { type: 'fixed', delay: this.backoffMs },
        removeOnComplete: this.removeOnComplete,
        removeOnFail: this.removeOnFail,
      });
      this.logger.debug(
        `enqueued reconcile cycle jobId=${job.id} correlationId=${correlationId}`,
      );
      return { jobId: String(job.id), deduped: false };
    } catch (err) {
      if (isJobIdExistsError(err, jobId)) {
        return { jobId, deduped: true };
      }
      throw err;
    }
  }
}

function isJobIdExistsError(err: unknown, jobId: string): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('already exists') ||
    msg.includes(jobId.toLowerCase()) ||
    msg.includes('duplicated')
  );
}
