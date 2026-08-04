import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { QueueModule } from './queue.module';
import { WhatsappInboundProcessor } from './workers/whatsapp-inbound.processor';

/**
 * Worker processors. Imported by AppModule when ASYNC_WORKERS_IN_API=true,
 * or by dedicated worker bootstrap (A2).
 *
 * 7.1: only whatsapp-inbound. Send/FollowUp/AI workers → 7.2.
 */
@Module({
  imports: [QueueModule, WhatsappModule],
  providers: [WhatsappInboundProcessor],
})
export class WorkerModule {}
