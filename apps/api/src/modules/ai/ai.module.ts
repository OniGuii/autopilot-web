import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../async/queue.module';
import { AiAssistPipelineService } from './ai-assist-pipeline.service';
import { AiController } from './ai.controller';
import { AiIntentService } from './ai-intent.service';
import { AiService } from './ai.service';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseResolver } from './knowledge-base-resolver.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { OpenAiClient } from './openai.client';

@Module({
  imports: [AuthModule, AuditModule, QueueModule],
  controllers: [AiController, AiSettingsController, KnowledgeBaseController],
  providers: [
    AiService,
    OpenAiClient,
    AiSettingsService,
    KnowledgeBaseService,
    KnowledgeBaseResolver,
    AiIntentService,
    AiAssistPipelineService,
  ],
  exports: [
    AiService,
    AiIntentService,
    KnowledgeBaseService,
    KnowledgeBaseResolver,
    AiSettingsService,
    AiAssistPipelineService,
  ],
})
export class AiModule {}
