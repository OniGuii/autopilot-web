import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  OUTBOUND_SEND_ATTEMPTS_DEFAULT,
  OUTBOUND_SEND_BACKOFF_MS_DEFAULT,
  OUTBOUND_SEND_JOB_NAME,
  QUEUE_OUTBOUND_SEND,
  QUEUE_REMOVE_ON_COMPLETE_DEFAULT,
  QUEUE_REMOVE_ON_FAIL_DEFAULT,
} from '../async.constants';
import type { OutboundSendJobPayload } from '../async.types';

@Injectable()
export class OutboundSendProducer {
  private readonly logger = new Logger(OutboundSendProducer.name);
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly removeOnComplete: number;
  private readonly removeOnFail: number;

  constructor(
    @InjectQueue(QUEUE_OUTBOUND_SEND)
    private readonly queue: Queue<OutboundSendJobPayload>,
    config: ConfigService,
  ) {
    this.attempts = config.get<number>(
      'async.outboundSendAttempts',
      OUTBOUND_SEND_ATTEMPTS_DEFAULT,
    );
    this.backoffMs = config.get<number>(
      'async.outboundSendBackoffMs',
      OUTBOUND_SEND_BACKOFF_MS_DEFAULT,
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
   * Enqueue outbound delivery. jobId = outbound:{messageId}
   * (one job per Message — prevents duplicate Evolution sends).
   */
  async enqueue(
    payload: OutboundSendJobPayload,
  ): Promise<{ jobId: string; deduped: boolean }> {
    const jobId = `outbound:${payload.messageId}`;
    try {
      const job = await this.queue.add(OUTBOUND_SEND_JOB_NAME, payload, {
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
        `enqueued outbound-send jobId=${job.id} correlationId=${payload.correlationId}`,
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
