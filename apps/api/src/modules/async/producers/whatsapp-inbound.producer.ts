import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
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
  }

  /**
   * Enqueue inbound processing. jobId = webhook:{webhookEventId} for idempotency.
   */
  async enqueue(payload: WhatsappInboundJobPayload): Promise<{ jobId: string }> {
    const jobId = `webhook:${payload.webhookEventId}`;
    const job = await this.queue.add(WHATSAPP_INBOUND_JOB_NAME, payload, {
      jobId,
      attempts: this.attempts,
      backoff: {
        type: 'exponential',
        delay: this.backoffMs,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });

    this.logger.log(
      `enqueued inbound jobId=${job.id} correlationId=${payload.correlationId} event=${payload.eventType}`,
    );

    return { jobId: String(job.id) };
  }
}
