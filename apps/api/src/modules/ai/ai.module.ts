import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../async/queue.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { OpenAiClient } from './openai.client';

@Module({
  imports: [AuthModule, AuditModule, QueueModule],
  controllers: [AiController],
  providers: [AiService, OpenAiClient],
  exports: [AiService],
})
export class AiModule {}
