import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FollowUpModule } from '../follow-up/follow-up.module';
import { OpsModule } from '../ops/ops.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { QueueModule } from './queue.module';
import { ReconcileCycleService } from './reconcile-cycle.service';
import { FollowUpSchedulerProcessor } from './workers/followup-scheduler.processor';
import { ReconcileProcessor } from './workers/reconcile.processor';
import { WhatsappInboundProcessor } from './workers/whatsapp-inbound.processor';

/**
 * Worker processors. Imported by AppModule when ASYNC_WORKERS_IN_API=true,
 * or by dedicated worker bootstrap (A2).
 *
 * 7.1: whatsapp-inbound
 * 7.2A: followup-scheduler
 * 7.2B: reconcile-worker
 * Send / AI workers — not started here.
 */
@Module({
  imports: [
    QueueModule,
    WhatsappModule,
    FollowUpModule,
    OpsModule,
    AuditModule,
  ],
  providers: [
    WhatsappInboundProcessor,
    FollowUpSchedulerProcessor,
    ReconcileCycleService,
    ReconcileProcessor,
  ],
})
export class WorkerModule {}
