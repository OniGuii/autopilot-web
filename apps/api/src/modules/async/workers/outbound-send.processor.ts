import {
  BadGatewayException,
  BadRequestException,
  BeforeApplicationShutdown,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { WhatsappSendService } from '../../whatsapp/outbound/whatsapp-send.service';
import { withBullJobContext } from '../../../observability/bull-job-context';
import { PrometheusMetricsService } from '../../../observability/prometheus-metrics.service';
import { AsyncMetricsService } from '../async-metrics.service';
import {
  OUTBOUND_SEND_ATTEMPTS_DEFAULT,
  QUEUE_OUTBOUND_SEND,
  resolveOutboundSendConcurrency,
  resolveOutboundSendLockDurationMs,
} from '../async.constants';
import type { OutboundSendJobPayload } from '../async.types';

@Processor(QUEUE_OUTBOUND_SEND, {
  concurrency: resolveOutboundSendConcurrency(),
  lockDuration: resolveOutboundSendLockDurationMs(),
})
export class OutboundSendProcessor
  extends WorkerHost
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(OutboundSendProcessor.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly whatsappSend: WhatsappSendService,
    private readonly metrics: AsyncMetricsService,
    private readonly prom: PrometheusMetricsService,
    config: ConfigService,
  ) {
    super();
    this.maxAttempts = config.get<number>(
      'async.outboundSendAttempts',
      OUTBOUND_SEND_ATTEMPTS_DEFAULT,
    );
  }

  onModuleInit(): void {
    this.logger.log(
      `outbound-send worker ready concurrency=${resolveOutboundSendConcurrency()}`,
    );
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`outbound-send shutdown signal=${signal ?? 'unknown'}`);
    try {
      if (this.worker) {
        await this.worker.close();
      }
    } catch (err) {
      this.logger.warn(
        `outbound-send worker close failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async process(job: Job<OutboundSendJobPayload>): Promise<{
    ok: true;
    messageId: string;
    status: string;
    correlationId: string;
  }> {
    return withBullJobContext(QUEUE_OUTBOUND_SEND, job, async () => {
      const started = Date.now();
      const data = job.data;
      this.logger.debug(
        `process outbound-send jobId=${job.id} messageId=${data.messageId} correlationId=${data.correlationId}`,
      );

      try {
        const result = await this.whatsappSend.processOutboundJob({
          companyId: data.companyId,
          messageId: data.messageId,
          actorUserId: data.actorUserId,
          correlationId: data.correlationId,
          meta: {
            ip: data.ip,
            userAgent: data.userAgent,
          },
        });

        const durationMs = Date.now() - started;
        this.metrics.recordOutboundSent(durationMs);
        this.prom.recordQueueJobDuration(QUEUE_OUTBOUND_SEND, durationMs);
        return {
          ok: true,
          messageId: result.messageId,
          status: result.status,
          correlationId: data.correlationId,
        };
      } catch (error) {
        if (isNonRetryableOutboundError(error)) {
          throw new UnrecoverableError(
            error instanceof Error
              ? error.message
              : 'non-retryable outbound error',
          );
        }
        throw error;
      } finally {
        this.metrics.recordProcessingDuration(Date.now() - started);
      }
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<OutboundSendJobPayload> | undefined, error: Error): void {
    if (!job) return;
    const attempts = job.opts.attempts ?? this.maxAttempts;
    const final =
      job.attemptsMade >= attempts || error instanceof UnrecoverableError;
    if (!final) {
      this.metrics.recordRetry();
      this.logger.warn(
        `outbound-send retry jobId=${job.id} attempt=${job.attemptsMade}/${attempts} correlationId=${job.data.correlationId} err=${error.message}`,
      );
      return;
    }
    this.metrics.recordOutboundFailed();
    this.logger.error(
      `outbound-send failed final jobId=${job.id} correlationId=${job.data.correlationId} err=${error.message}`,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.metrics.recordStalled();
    this.logger.warn(`outbound-send stalled jobId=${jobId}`);
  }
}

/**
 * After Message is PENDING, Evolution failures are domain-terminal (A8).
 * Retry only unexpected infra before claim/send (rare with attempts=1).
 */
function isNonRetryableOutboundError(error: unknown): boolean {
  if (error instanceof UnrecoverableError) return true;
  if (error instanceof NotFoundException) return true;
  if (error instanceof BadRequestException) return true;
  if (error instanceof ConflictException) return true;
  if (error instanceof BadGatewayException) return true;
  if (error instanceof ServiceUnavailableException) return true;
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return status >= 400 && status < 500;
  }
  return false;
}
