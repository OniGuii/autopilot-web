import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_DLQ_WHATSAPP_INBOUND,
  QUEUE_WHATSAPP_INBOUND,
} from './async.constants';

/**
 * 7.1-H — close Bull queues after workers drain
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
  ) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.log(`queue shutdown begin signal=${signal ?? 'unknown'}`);

    try {
      // Global pause — stop new jobs entering wait while workers finish.
      await this.inbound.pause();
    } catch (err) {
      this.logger.warn(
        `pause inbound failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    await Promise.allSettled([this.inbound.close(), this.dlq.close()]);
    this.logger.log('queue shutdown complete');
  }
}
