import { Module } from '@nestjs/common';
import { FollowUpModule } from '../follow-up/follow-up.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { QueueModule } from './queue.module';
import { FollowUpSchedulerProcessor } from './workers/followup-scheduler.processor';
import { WhatsappInboundProcessor } from './workers/whatsapp-inbound.processor';

/**
 * Worker processors. Imported by AppModule when ASYNC_WORKERS_IN_API=true,
 * or by dedicated worker bootstrap (A2).
 *
 * 7.1: whatsapp-inbound
 * 7.2A: followup-scheduler
 * Send / AI / Reconcile workers — not started here.
 */
@Module({
  imports: [QueueModule, WhatsappModule, FollowUpModule],
  providers: [WhatsappInboundProcessor, FollowUpSchedulerProcessor],
})
export class WorkerModule {}
