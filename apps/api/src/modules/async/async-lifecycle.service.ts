import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_AI_SUGGESTIONS,
  QUEUE_DLQ_WHATSAPP_INBOUND,
  QUEUE_FOLLOWUP_SCHEDULER,
  QUEUE_RECONCILE_WORKER,
  QUEUE_WHATSAPP_INBOUND,
} from './async.constants';

/**
 * Graceful shutdown — close Bull queues after workers drain
 * (workers implement BeforeApplicationShutdown).
 */
@Injectable()
export class AsyncLifecycleService implements OnApplicationShutdown {
  private readonly logger = new Logger(AsyncLifecycleService.name);
  private shuttingDown = false;

  constructor(
    @InjectQueue(QUEUE_WHATSAPP_INBOUND)
    private readonly inbound: Queue,
    @InjectQueue(QUEUE_DLQ_WHATSAPP_INBOUND)
    private readonly dlq: Queue,
    @InjectQueue(QUEUE_FOLLOWUP_SCHEDULER)
    private readonly followupScheduler: Queue,
    @InjectQueue(QUEUE_RECONCILE_WORKER)
    private readonly reconcileWorker: Queue,
    @InjectQueue(QUEUE_AI_SUGGESTIONS)
    private readonly aiSuggestions: Queue,
  ) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.log(`queue shutdown begin signal=${signal ?? 'unknown'}`);

    await Promise.allSettled([
      this.inbound.pause(),
      this.followupScheduler.pause(),
      this.reconcileWorker.pause(),
      this.aiSuggestions.pause(),
    ]);

    await Promise.allSettled([
      this.inbound.close(),
      this.dlq.close(),
      this.followupScheduler.close(),
      this.reconcileWorker.close(),
      this.aiSuggestions.close(),
    ]);
    this.logger.log('queue shutdown complete');
  }
}
