import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../prisma/prisma.module';
import { SharedModule } from '../../shared/shared.module';
import { AsyncLifecycleService } from './async-lifecycle.service';
import {
  ASYNC_QUEUE_PREFIX,
  QUEUE_DLQ_WHATSAPP_INBOUND,
  QUEUE_FOLLOWUP_SCHEDULER,
  QUEUE_WHATSAPP_INBOUND,
} from './async.constants';
import { AsyncMetricsService } from './async-metrics.service';
import { DlqService } from './dlq.service';
import { FollowUpDueScanner } from './followup-due.scanner';
import { FollowUpSchedulerProducer } from './producers/followup-scheduler.producer';
import { WhatsappInboundProducer } from './producers/whatsapp-inbound.producer';

/**
 * BullMQ foundation — connection + queues + producers + DLQ + metrics.
 * Does not register workers (see WorkerModule).
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    SharedModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const password = config.get<string>('redis.password') || undefined;
        return {
          prefix: ASYNC_QUEUE_PREFIX,
          connection: {
            host: config.get<string>('redis.host', 'localhost'),
            port: config.get<number>('redis.port', 6379),
            ...(password ? { password } : {}),
            // BullMQ requires null (blocking commands).
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE_WHATSAPP_INBOUND },
      { name: QUEUE_DLQ_WHATSAPP_INBOUND },
      { name: QUEUE_FOLLOWUP_SCHEDULER },
    ),
  ],
  providers: [
    WhatsappInboundProducer,
    FollowUpSchedulerProducer,
    FollowUpDueScanner,
    DlqService,
    AsyncMetricsService,
    AsyncLifecycleService,
  ],
  exports: [
    BullModule,
    WhatsappInboundProducer,
    FollowUpSchedulerProducer,
    DlqService,
    AsyncMetricsService,
  ],
})
export class QueueModule {}
