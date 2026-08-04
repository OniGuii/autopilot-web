import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  QUEUE_REMOVE_ON_COMPLETE_DEFAULT,
  QUEUE_REMOVE_ON_FAIL_DEFAULT,
  QUEUE_WHATSAPP_INBOUND,
  WHATSAPP_INBOUND_ATTEMPTS_DEFAULT,
  WHATSAPP_INBOUND_BACKOFF_MS_DEFAULT,
  WHATSAPP_INBOUND_JOB_NAME,
} from '../async.constants';
import type { WhatsappInboundJobPayload } from '../async.types';

@Injectable()
export class WhatsappInboundProducer {
  private readonly logger = new Logger(WhatsappInboundProducer.name);
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly removeOnComplete: number;
  private readonly removeOnFail: number;

  constructor(
    @InjectQueue(QUEUE_WHATSAPP_INBOUND)
    private readonly queue: Queue<WhatsappInboundJobPayload>,
    config: ConfigService,
  ) {
    this.attempts = config.get<number>(
      'async.inboundAttempts',
      WHATSAPP_INBOUND_ATTEMPTS_DEFAULT,
    );
    this.backoffMs = config.get<number>(
      'async.inboundBackoffMs',
      WHATSAPP_INBOUND_BACKOFF_MS_DEFAULT,
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
   * Enqueue inbound processing. jobId = webhook:{webhookEventId} for idempotency.
   * Duplicate jobId is treated as success (BullMQ handleDuplicatedJob / existing key).
   */
  async enqueue(
    payload: WhatsappInboundJobPayload,
  ): Promise<{ jobId: string }> {
    const jobId = `webhook:${payload.webhookEventId}`;
    try {
      const job = await this.queue.add(WHATSAPP_INBOUND_JOB_NAME, payload, {
        jobId,
        attempts: this.attempts,
        backoff: {
          type: 'exponential',
          delay: this.backoffMs,
        },
        removeOnComplete: this.removeOnComplete,
        removeOnFail: this.removeOnFail,
      });

      this.logger.log(
        `enqueued inbound jobId=${job.id} correlationId=${payload.correlationId} event=${payload.eventType}`,
      );

      return { jobId: String(job.id) };
    } catch (err) {
      if (isJobIdExistsError(err, jobId)) {
        this.logger.log(
          `inbound job already exists jobId=${jobId} correlationId=${payload.correlationId}`,
        );
        return { jobId };
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
    msg.includes(`job ${jobId.toLowerCase()}`) ||
    msg.includes('duplicated')
  );
}
