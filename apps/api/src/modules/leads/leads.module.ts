import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { LeadActivitiesController } from './lead-activities.controller';
import { LeadActivitiesService } from './lead-activities.service';
import { LeadNotesController } from './lead-notes.controller';
import { LeadNotesService } from './lead-notes.service';
import { LeadTimelineService } from './lead-timeline.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [AuthModule, AuditModule],
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
