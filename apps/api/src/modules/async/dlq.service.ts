import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_DLQ_WHATSAPP_INBOUND,
  QUEUE_WHATSAPP_INBOUND,
} from './async.constants';
import type { DlqJobPayload, WhatsappInboundJobPayload } from './async.types';

/**
 * Basic DLQ — failed inbound jobs after retries (A10: manual replay later).
 */
@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(
    @InjectQueue(QUEUE_DLQ_WHATSAPP_INBOUND)
    private readonly dlq: Queue<DlqJobPayload>,
  ) {}

  async moveWhatsappInboundToDlq(input: {
    originalJobId: string;
    failedReason: string;
    payload: WhatsappInboundJobPayload;
    attemptsMade: number;
  }): Promise<void> {
    const body: DlqJobPayload = {
      v: 1,
      originalQueue: QUEUE_WHATSAPP_INBOUND,
      originalJobId: input.originalJobId,
      failedReason: input.failedReason.slice(0, 1000),
      payload: input.payload,
      correlationId: input.payload.correlationId,
      failedAt: new Date().toISOString(),
      attemptsMade: input.attemptsMade,
    };

    await this.dlq.add('dead-letter', body, {
      jobId: `dlq:${input.originalJobId}`,
      removeOnComplete: false,
      removeOnFail: false,
    });

    this.logger.warn(
      `DLQ inbound jobId=${input.originalJobId} correlationId=${input.payload.correlationId} reason=${body.failedReason}`,
    );
  }

  async getDepth(): Promise<number> {
    const counts = await this.dlq.getJobCounts('waiting', 'delayed', 'failed');
    return (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.failed ?? 0);
  }
}
