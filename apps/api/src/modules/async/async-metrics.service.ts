import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_DLQ_WHATSAPP_INBOUND,
  QUEUE_WHATSAPP_INBOUND,
} from './async.constants';
import { DlqService } from './dlq.service';

export type QueueMetricsSnapshot = {
  whatsappInbound: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  dlqWhatsappInbound: number;
};

@Injectable()
export class AsyncMetricsService {
  private readonly logger = new Logger(AsyncMetricsService.name);

  constructor(
    @InjectQueue(QUEUE_WHATSAPP_INBOUND)
    private readonly inbound: Queue,
    @InjectQueue(QUEUE_DLQ_WHATSAPP_INBOUND)
    private readonly dlqQueue: Queue,
    private readonly dlq: DlqService,
  ) {}

  async snapshot(): Promise<QueueMetricsSnapshot> {
    try {
      const [inboundCounts, dlqDepth] = await Promise.all([
        this.inbound.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
        ),
        this.dlq.getDepth(),
      ]);

      return {
        whatsappInbound: {
          waiting: inboundCounts.waiting ?? 0,
          active: inboundCounts.active ?? 0,
          completed: inboundCounts.completed ?? 0,
          failed: inboundCounts.failed ?? 0,
          delayed: inboundCounts.delayed ?? 0,
        },
        dlqWhatsappInbound: dlqDepth,
      };
    } catch (err) {
      this.logger.warn(
        `async metrics unavailable: ${err instanceof Error ? err.message : err}`,
      );
      return {
        whatsappInbound: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
        dlqWhatsappInbound: 0,
      };
    }
  }
}
