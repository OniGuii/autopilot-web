import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../prisma/prisma.module';
import { SharedModule } from '../../shared/shared.module';
import { AsyncLifecycleService } from './async-lifecycle.service';
import {
  ASYNC_QUEUE_PREFIX,
  QUEUE_AI_SUGGESTIONS,
  QUEUE_DLQ_WHATSAPP_INBOUND,
  QUEUE_FOLLOWUP_SCHEDULER,
  QUEUE_RECONCILE_WORKER,
  QUEUE_WHATSAPP_INBOUND,
} from './async.constants';
import { AsyncMetricsService } from './async-metrics.service';
import { DlqService } from './dlq.service';
import { FollowUpDueScanner } from './followup-due.scanner';
import { AiSuggestionProducer } from './producers/ai-suggestion.producer';
import { FollowUpSchedulerProducer } from './producers/followup-scheduler.producer';
import { ReconcileProducer } from './producers/reconcile.producer';
import { ReconcileScheduler } from './reconcile.scheduler';
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
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE_WHATSAPP_INBOUND },
      { name: QUEUE_DLQ_WHATSAPP_INBOUND },
      { name: QUEUE_FOLLOWUP_SCHEDULER },
      { name: QUEUE_RECONCILE_WORKER },
      { name: QUEUE_AI_SUGGESTIONS },
    ),
  ],
  providers: [
    WhatsappInboundProducer,
    FollowUpSchedulerProducer,
    FollowUpDueScanner,
    ReconcileProducer,
    ReconcileScheduler,
    AiSuggestionProducer,
    DlqService,
    AsyncMetricsService,
    AsyncLifecycleService,
  ],
  exports: [
    BullModule,
    WhatsappInboundProducer,
    FollowUpSchedulerProducer,
    ReconcileProducer,
    AiSuggestionProducer,
    DlqService,
    AsyncMetricsService,
  ],
})
export class QueueModule {}
