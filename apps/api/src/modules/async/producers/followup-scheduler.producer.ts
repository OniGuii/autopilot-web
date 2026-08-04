import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  FOLLOWUP_SCHEDULER_ATTEMPTS_DEFAULT,
  FOLLOWUP_SCHEDULER_BACKOFF_MS_DEFAULT,
  FOLLOWUP_SCHEDULER_JOB_NAME,
  QUEUE_FOLLOWUP_SCHEDULER,
  QUEUE_REMOVE_ON_COMPLETE_DEFAULT,
  QUEUE_REMOVE_ON_FAIL_DEFAULT,
} from '../async.constants';
import type { FollowUpSchedulerJobPayload } from '../async.types';

@Injectable()
export class FollowUpSchedulerProducer {
  private readonly logger = new Logger(FollowUpSchedulerProducer.name);
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly removeOnComplete: number;
  private readonly removeOnFail: number;

  constructor(
    @InjectQueue(QUEUE_FOLLOWUP_SCHEDULER)
    private readonly queue: Queue<FollowUpSchedulerJobPayload>,
    config: ConfigService,
  ) {
    this.attempts = config.get<number>(
      'async.followupAttempts',
      FOLLOWUP_SCHEDULER_ATTEMPTS_DEFAULT,
    );
    this.backoffMs = config.get<number>(
      'async.followupBackoffMs',
      FOLLOWUP_SCHEDULER_BACKOFF_MS_DEFAULT,
    );
    this.removeOnComplete = config.get<number>(
      'async.removeOnComplete',
      QUEUE_REMOVE_ON_COMPLETE_DEFAULT,
    );
    this.removeOnFail = config.get<number>(
      'async.removeOnFail',
      QUEUE_REMOVE_ON_FAIL_DEFAULT,
    );
  }

  /**
   * Enqueue due follow-up. jobId = followup:sched:{followUpId} (dedupe).
   */
  async enqueue(
    payload: FollowUpSchedulerJobPayload,
  ): Promise<{ jobId: string; deduped: boolean }> {
    const jobId = `followup:sched:${payload.followUpId}`;
    try {
      const job = await this.queue.add(FOLLOWUP_SCHEDULER_JOB_NAME, payload, {
        jobId,
        attempts: this.attempts,
        backoff: {
          type: 'exponential',
          delay: this.backoffMs,
        },
        removeOnComplete: this.removeOnComplete,
        removeOnFail: this.removeOnFail,
      });
      this.logger.debug(
        `enqueued followup jobId=${job.id} correlationId=${payload.correlationId}`,
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
