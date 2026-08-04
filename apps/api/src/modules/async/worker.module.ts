import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { FollowUpModule } from '../follow-up/follow-up.module';
import { OpsModule } from '../ops/ops.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { QueueModule } from './queue.module';
import { ReconcileCycleService } from './reconcile-cycle.service';
import { AiSuggestionProcessor } from './workers/ai-suggestion.processor';
import { FollowUpSchedulerProcessor } from './workers/followup-scheduler.processor';
import { OutboundSendProcessor } from './workers/outbound-send.processor';
import { ReconcileProcessor } from './workers/reconcile.processor';
import { WhatsappInboundProcessor } from './workers/whatsapp-inbound.processor';

/**
 * Worker processors. Imported by AppModule when ASYNC_WORKERS_IN_API=true,
 * or by dedicated worker bootstrap (A2).
 *
 * 7.1: whatsapp-inbound
 * 7.2A: followup-scheduler
 * 7.2B: reconcile-worker
 * 7.2C: ai-suggestions
 * 8C: outbound-send
 */
@Module({
  imports: [
    QueueModule,
    WhatsappModule,
    FollowUpModule,
    OpsModule,
    AuditModule,
    AiModule,
  ],
  providers: [
    WhatsappInboundProcessor,
    FollowUpSchedulerProcessor,
    ReconcileCycleService,
    ReconcileProcessor,
    AiSuggestionProcessor,
    OutboundSendProcessor,
  ],
})
export class WorkerModule {}
