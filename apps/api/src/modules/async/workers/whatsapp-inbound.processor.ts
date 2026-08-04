import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import {
  ASYNC_LOCK_DURATION_MS_DEFAULT,
  QUEUE_WHATSAPP_INBOUND,
  WHATSAPP_INBOUND_ATTEMPTS_DEFAULT,
  WHATSAPP_INBOUND_CONCURRENCY_DEFAULT,
} from '../async.constants';
import type { WhatsappInboundJobPayload } from '../async.types';
import { DlqService } from '../dlq.service';

@Processor(QUEUE_WHATSAPP_INBOUND, {
  concurrency: WHATSAPP_INBOUND_CONCURRENCY_DEFAULT,
  lockDuration: ASYNC_LOCK_DURATION_MS_DEFAULT,
})
export class WhatsappInboundProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsappInboundProcessor.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly dlq: DlqService,
    config: ConfigService,
  ) {
    super();
    this.maxAttempts = config.get<number>(
      'async.inboundAttempts',
      WHATSAPP_INBOUND_ATTEMPTS_DEFAULT,
    );
  }

  async process(job: Job<WhatsappInboundJobPayload>): Promise<{
    ok: true;
    correlationId: string;
  }> {
    const data = job.data;
    this.logger.debug(
      `process inbound jobId=${job.id} correlationId=${data.correlationId} webhookEventId=${data.webhookEventId}`,
    );

    await this.whatsapp.processQueuedWebhook(data);

    return { ok: true, correlationId: data.correlationId };
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<WhatsappInboundJobPayload> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const attempts = job.opts.attempts ?? this.maxAttempts;
    if (job.attemptsMade < attempts) {
      this.logger.warn(
        `inbound retry jobId=${job.id} attempt=${job.attemptsMade}/${attempts} correlationId=${job.data.correlationId} err=${error.message}`,
      );
      return;
    }

    try {
      await this.dlq.moveWhatsappInboundToDlq({
        originalJobId: String(job.id),
        failedReason: error.message,
        payload: job.data,
        attemptsMade: job.attemptsMade,
      });
    } catch (dlqErr) {
      this.logger.error(
        `failed to move job to DLQ jobId=${job.id}: ${dlqErr instanceof Error ? dlqErr.message : dlqErr}`,
      );
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<WhatsappInboundJobPayload>): void {
    this.logger.debug(
      `inbound completed jobId=${job.id} correlationId=${job.data.correlationId}`,
    );
  }
}
