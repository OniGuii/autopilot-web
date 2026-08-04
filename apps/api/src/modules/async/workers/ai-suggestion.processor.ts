import {
  BadRequestException,
  BeforeApplicationShutdown,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { AiService } from '../../ai/ai.service';
import { AsyncMetricsService } from '../async-metrics.service';
import {
  AI_SUGGEST_ATTEMPTS_DEFAULT,
  QUEUE_AI_SUGGESTIONS,
  resolveAiSuggestConcurrency,
  resolveAiSuggestLockDurationMs,
} from '../async.constants';
import type { AiSuggestionJobPayload } from '../async.types';

@Processor(QUEUE_AI_SUGGESTIONS, {
  concurrency: resolveAiSuggestConcurrency(),
  lockDuration: resolveAiSuggestLockDurationMs(),
})
export class AiSuggestionProcessor
  extends WorkerHost
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(AiSuggestionProcessor.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly ai: AiService,
    private readonly metrics: AsyncMetricsService,
    config: ConfigService,
  ) {
    super();
    this.maxAttempts = config.get<number>(
      'async.aiSuggestAttempts',
      AI_SUGGEST_ATTEMPTS_DEFAULT,
    );
  }

  onModuleInit(): void {
    this.logger.log(
      `ai-suggestions worker ready concurrency=${resolveAiSuggestConcurrency()}`,
    );
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`ai-suggestions shutdown signal=${signal ?? 'unknown'}`);
    try {
      if (this.worker) {
        await this.worker.close();
      }
    } catch (err) {
      this.logger.warn(
        `ai-suggestions worker close failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async process(job: Job<AiSuggestionJobPayload>): Promise<{
    ok: true;
    followUpId: string;
    correlationId: string;
  }> {
    const started = Date.now();
    const data = job.data;
    this.logger.debug(
      `process ai-suggestion jobId=${job.id} conversationId=${data.conversationId} correlationId=${data.correlationId}`,
    );

    try {
      const result = await this.ai.processSuggestJob({
        companyId: data.companyId,
        actorUserId: data.actorUserId,
        conversationId: data.conversationId,
        dto: {
          ...(data.tone ? { tone: data.tone } : {}),
          ...(data.instruction ? { instruction: data.instruction } : {}),
        },
        meta: {
          ip: data.ip,
          userAgent: data.userAgent,
        },
      });

      this.metrics.recordAiGenerated(Date.now() - started);
      return {
        ok: true,
        followUpId: result.followUpId,
        correlationId: data.correlationId,
      };
    } catch (error) {
      if (isNonRetryableAiError(error)) {
        throw new UnrecoverableError(
          error instanceof Error ? error.message : 'non-retryable ai error',
        );
      }
      throw error;
    } finally {
      this.metrics.recordProcessingDuration(Date.now() - started);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AiSuggestionJobPayload> | undefined, error: Error): void {
    if (!job) return;
    const attempts = job.opts.attempts ?? this.maxAttempts;
    const final =
      job.attemptsMade >= attempts || error instanceof UnrecoverableError;
    if (!final) {
      this.metrics.recordRetry();
      this.logger.warn(
        `ai-suggestion retry jobId=${job.id} attempt=${job.attemptsMade}/${attempts} correlationId=${job.data.correlationId} err=${error.message}`,
      );
      return;
    }
    this.metrics.recordAiFailed();
    this.logger.error(
      `ai-suggestion failed final jobId=${job.id} correlationId=${job.data.correlationId} err=${error.message}`,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.metrics.recordStalled();
    this.logger.warn(`ai-suggestion stalled jobId=${jobId}`);
  }
}

/**
 * Retry only transient infra/provider errors (e.g. OpenAI 503).
 * No retry: quota (429), validation (400), 404, conflict, forbidden, invalid prompt.
 */
function isNonRetryableAiError(error: unknown): boolean {
  if (error instanceof UnrecoverableError) return true;
  if (error instanceof NotFoundException) return true;
  if (error instanceof BadRequestException) return true;
  if (error instanceof ConflictException) return true;
  if (error instanceof ForbiddenException) return true;
  if (error instanceof ServiceUnavailableException) {
    return false;
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    // Quota / client errors — do not retry (incl. 429).
    if (status === 429) return true;
    return status >= 400 && status < 500;
  }
  return false;
}
