import {
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
import { FollowUpService } from '../../follow-up/follow-up.service';
import { AsyncMetricsService } from '../async-metrics.service';
import {
  ASYNC_LOCK_DURATION_MS_DEFAULT,
  FOLLOWUP_SCHEDULER_ATTEMPTS_DEFAULT,
  QUEUE_FOLLOWUP_SCHEDULER,
  resolveFollowupSchedulerConcurrency,
} from '../async.constants';
import type { FollowUpSchedulerJobPayload } from '../async.types';

@Processor(QUEUE_FOLLOWUP_SCHEDULER, {
  concurrency: resolveFollowupSchedulerConcurrency(),
  lockDuration: ASYNC_LOCK_DURATION_MS_DEFAULT,
})
export class FollowUpSchedulerProcessor
  extends WorkerHost
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(FollowUpSchedulerProcessor.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly followUps: FollowUpService,
    private readonly metrics: AsyncMetricsService,
    config: ConfigService,
  ) {
    super();
    this.maxAttempts = config.get<number>(
      'async.followupAttempts',
      FOLLOWUP_SCHEDULER_ATTEMPTS_DEFAULT,
    );
  }

  onModuleInit(): void {
    this.logger.log(
      `followup-scheduler worker ready concurrency=${resolveFollowupSchedulerConcurrency()}`,
    );
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      `followup-scheduler shutdown signal=${signal ?? 'unknown'}`,
    );
    try {
      if (this.worker) {
        await this.worker.close();
      }
    } catch (err) {
      this.logger.warn(
        `followup worker close failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async process(job: Job<FollowUpSchedulerJobPayload>): Promise<{
    ok: true;
    outcome: string;
    correlationId: string;
  }> {
    const started = Date.now();
    const data = job.data;
    this.logger.debug(
      `process followup jobId=${job.id} followUpId=${data.followUpId} correlationId=${data.correlationId}`,
    );

    try {
      const result = await this.followUps.executeDue({
        companyId: data.companyId,
        followUpId: data.followUpId,
        correlationId: data.correlationId,
      });

      if (result.outcome === 'skipped_claim') {
        this.metrics.recordClaimFailure();
      }

      return {
        ok: true,
        outcome: result.outcome,
        correlationId: result.correlationId,
      };
    } catch (error) {
      if (isNonRetryableFollowUpError(error)) {
        throw new UnrecoverableError(
          error instanceof Error
            ? error.message
            : 'non-retryable followup error',
        );
      }
      throw error;
    } finally {
      this.metrics.recordProcessingDuration(Date.now() - started);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(
    job: Job<FollowUpSchedulerJobPayload> | undefined,
    error: Error,
  ): void {
    if (!job) return;
    const attempts = job.opts.attempts ?? this.maxAttempts;
    if (job.attemptsMade < attempts && !(error instanceof UnrecoverableError)) {
      this.metrics.recordRetry();
      this.logger.warn(
        `followup retry jobId=${job.id} attempt=${job.attemptsMade}/${attempts} correlationId=${job.data.correlationId} err=${error.message}`,
      );
      return;
    }
    this.logger.error(
      `followup failed final jobId=${job.id} correlationId=${job.data.correlationId} err=${error.message}`,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.metrics.recordStalled();
    this.logger.warn(`followup stalled jobId=${jobId}`);
  }
}

function isNonRetryableFollowUpError(error: unknown): boolean {
  if (error instanceof UnrecoverableError) return true;
  if (error instanceof NotFoundException) return true;
  if (error instanceof BadRequestException) return true;
  if (error instanceof ConflictException) {
    // disconnected / not executable / max attempts — do not retry
    return true;
  }
  if (error instanceof ServiceUnavailableException) {
    // Circuit OPEN / channel unavailable — transient
    return false;
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 429) return false;
    return status >= 400 && status < 500;
  }
  return false;
}
