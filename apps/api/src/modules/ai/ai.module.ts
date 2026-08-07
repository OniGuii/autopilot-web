import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../async/queue.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AiAssistPipelineService } from './ai-assist-pipeline.service';
import { AiAutoGuardrailsService } from './ai-auto-guardrails.service';
import { AiController } from './ai.controller';
import { AiDashboardService } from './ai-dashboard.service';
import { AiIntentService } from './ai-intent.service';
import { AiRecoveryController } from './ai-recovery.controller';
import { AiRecoveryDashboardService } from './ai-recovery-dashboard.service';
import { AiRecoveryMessageService } from './ai-recovery-message.service';
import { AiRecoveryScanner } from './ai-recovery.scanner';
import { AiRecoveryService } from './ai-recovery.service';
import { AiRecoverySettingsService } from './ai-recovery-settings.service';
import { AiService } from './ai.service';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseResolver } from './knowledge-base-resolver.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { OpenAiClient } from './openai.client';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    QueueModule,
    forwardRef(() => WhatsappModule),
  ],
  controllers: [
    AiController,
    AiSettingsController,
    KnowledgeBaseController,
    AiRecoveryController,
  ],
  providers: [
    AiService,
    OpenAiClient,
    AiSettingsService,
    KnowledgeBaseService,
    KnowledgeBaseResolver,
    AiIntentService,
    AiAutoGuardrailsService,
    AiAssistPipelineService,
    AiDashboardService,
    AiRecoverySettingsService,
    AiRecoveryMessageService,
    AiRecoveryService,
    AiRecoveryDashboardService,
    AiRecoveryScanner,
  ],
  exports: [
    AiService,
    AiIntentService,
    KnowledgeBaseService,
    KnowledgeBaseResolver,
    AiSettingsService,
    AiAssistPipelineService,
    AiDashboardService,
    AiRecoveryService,
    AiRecoverySettingsService,
  ],
})
export class AiModule {}
