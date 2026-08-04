import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  AI_SUGGEST_ATTEMPTS_DEFAULT,
  AI_SUGGEST_BACKOFF_MS_DEFAULT,
  AI_SUGGESTION_JOB_NAME,
  QUEUE_AI_SUGGESTIONS,
  QUEUE_REMOVE_ON_COMPLETE_DEFAULT,
  QUEUE_REMOVE_ON_FAIL_DEFAULT,
} from '../async.constants';
import type { AiSuggestionJobPayload } from '../async.types';

@Injectable()
export class AiSuggestionProducer {
  private readonly logger = new Logger(AiSuggestionProducer.name);
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly removeOnComplete: number;
  private readonly removeOnFail: number;

  constructor(
    @InjectQueue(QUEUE_AI_SUGGESTIONS)
    private readonly queue: Queue<AiSuggestionJobPayload>,
    config: ConfigService,
  ) {
    this.attempts = config.get<number>(
      'async.aiSuggestAttempts',
      AI_SUGGEST_ATTEMPTS_DEFAULT,
    );
    this.backoffMs = config.get<number>(
      'async.aiSuggestBackoffMs',
      AI_SUGGEST_BACKOFF_MS_DEFAULT,
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
   * Enqueue AI suggestion. jobId = ai:suggest:{companyId}:{conversationId}
   * (one pending/active job per conversation — concurrent prevention).
   */
  async enqueue(
    payload: AiSuggestionJobPayload,
  ): Promise<{ jobId: string; deduped: boolean }> {
    const jobId = `ai:suggest:${payload.companyId}:${payload.conversationId}`;
    try {
      const job = await this.queue.add(AI_SUGGESTION_JOB_NAME, payload, {
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
        `enqueued ai-suggestion jobId=${job.id} correlationId=${payload.correlationId}`,
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
