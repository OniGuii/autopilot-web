import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OutboundModule } from '../outbound/outbound.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { FollowUpController } from './follow-up.controller';
import { FollowUpService } from './follow-up.service';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    WhatsappModule,
    forwardRef(() => AiModule),
    forwardRef(() => OutboundModule),
  ],
  controllers: [FollowUpController],
  providers: [FollowUpService],
  exports: [FollowUpService],
})
export class FollowUpModule {}
