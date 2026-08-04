import {
  BeforeApplicationShutdown,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { AsyncMetricsService } from '../async-metrics.service';
import {
  ASYNC_LOCK_DURATION_MS_DEFAULT,
  QUEUE_WHATSAPP_INBOUND,
  WHATSAPP_INBOUND_ATTEMPTS_DEFAULT,
  resolveQueueConcurrency,
} from '../async.constants';
import type { WhatsappInboundJobPayload } from '../async.types';
import { DlqService } from '../dlq.service';

@Processor(QUEUE_WHATSAPP_INBOUND, {
  concurrency: resolveQueueConcurrency(),
  lockDuration: ASYNC_LOCK_DURATION_MS_DEFAULT,
})
export class WhatsappInboundProcessor
  extends WorkerHost
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(WhatsappInboundProcessor.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly dlq: DlqService,
    private readonly metrics: AsyncMetricsService,
    config: ConfigService,
  ) {
    super();
    this.maxAttempts = config.get<number>(
      'async.inboundAttempts',
      WHATSAPP_INBOUND_ATTEMPTS_DEFAULT,
    );
  }

  onModuleInit(): void {
    this.logger.log(
      `whatsapp-inbound worker ready concurrency=${resolveQueueConcurrency()}`,
    );
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      `worker shutdown begin signal=${signal ?? 'unknown'} — draining active jobs`,
    );
    try {
      if (this.worker) {
        await this.worker.close();
      }
    } catch (err) {
      this.logger.warn(
        `worker close failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async process(job: Job<WhatsappInboundJobPayload>): Promise<{
    ok: true;
    correlationId: string;
    skipped?: boolean;
    reason?: string;
  }> {
    const started = Date.now();
    const data = job.data;
    this.logger.debug(
      `process inbound jobId=${job.id} correlationId=${data.correlationId} webhookEventId=${data.webhookEventId}`,
    );

    try {
      const result = await this.whatsapp.processQueuedWebhook(data);
      if (result.reason === 'CLAIM_FAILED') {
        this.metrics.recordClaimFailure();
      }
      return {
        ok: true,
        correlationId: data.correlationId,
        skipped: Boolean(result.ignored),
        reason: result.reason,
      };
    } finally {
      this.metrics.recordProcessingDuration(Date.now() - started);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<WhatsappInboundJobPayload> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const attempts = job.opts.attempts ?? this.maxAttempts;
    if (job.attemptsMade < attempts) {
      this.metrics.recordRetry();
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

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.metrics.recordStalled();
    this.logger.warn(`inbound stalled jobId=${jobId}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<WhatsappInboundJobPayload>): void {
    this.logger.debug(
      `inbound completed jobId=${job.id} correlationId=${job.data.correlationId}`,
    );
  }
}
