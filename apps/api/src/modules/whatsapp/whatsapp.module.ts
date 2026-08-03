import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { EvolutionClient } from './evolution.client';
import { WhatsappInboundService } from './inbound/whatsapp-inbound.service';
import { WhatsappDeliveryService } from './outbound/whatsapp-delivery.service';
import { WhatsappSendService } from './outbound/whatsapp-send.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    WhatsappInboundService,
    WhatsappSendService,
    WhatsappDeliveryService,
    EvolutionClient,
  ],
  exports: [WhatsappService, WhatsappSendService],
})
export class WhatsappModule {}
