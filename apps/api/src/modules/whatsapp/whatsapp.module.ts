import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../async/queue.module';
import { AiModule } from '../ai/ai.module';
import { EvolutionChannelMetrics } from './evolution.channel-metrics';
import { EvolutionClient } from './evolution.client';
import { WhatsappInboundService } from './inbound/whatsapp-inbound.service';
import { WhatsappDeliveryService } from './outbound/whatsapp-delivery.service';
import { WhatsappSendService } from './outbound/whatsapp-send.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [AuthModule, AuditModule, QueueModule, forwardRef(() => AiModule)],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    WhatsappInboundService,
    WhatsappSendService,
    WhatsappDeliveryService,
    EvolutionChannelMetrics,
    EvolutionClient,
  ],
  exports: [
    WhatsappService,
    WhatsappSendService,
    EvolutionClient,
    EvolutionChannelMetrics,
  ],
})
export class WhatsappModule {}
