import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OutboundModule } from '../outbound/outbound.module';
import { LeadActivitiesController } from './lead-activities.controller';
import { LeadActivitiesService } from './lead-activities.service';
import { LeadNotesController } from './lead-notes.controller';
import { LeadNotesService } from './lead-notes.service';
import { LeadTimelineService } from './lead-timeline.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    forwardRef(() => AiModule),
    OutboundModule,
  ],
  controllers: [
    LeadsController,
    LeadNotesController,
    LeadActivitiesController,
  ],
  providers: [
    LeadsService,
    LeadNotesService,
    LeadActivitiesService,
    LeadTimelineService,
  ],
  exports: [
    LeadsService,
    LeadNotesService,
    LeadActivitiesService,
    LeadTimelineService,
  ],
})
export class LeadsModule {}
