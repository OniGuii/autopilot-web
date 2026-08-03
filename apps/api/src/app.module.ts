import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { CoreModule } from './core/core.module';
import { SharedModule } from './shared/shared.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { UsersModule } from './modules/users/users.module';
import { LeadsModule } from './modules/leads/leads.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { AiModule } from './modules/ai/ai.module';
import { FollowUpModule } from './modules/follow-up/follow-up.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EventsModule } from './modules/events/events.module';
import { AuditModule } from './modules/audit/audit.module';
import { OpsModule } from './modules/ops/ops.module';

@Module({
  imports: [
    AppConfigModule,
    CoreModule,
    SharedModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    CompaniesModule,
    UsersModule,
    LeadsModule,
    ConversationsModule,
    WhatsappModule,
    AiModule,
    FollowUpModule,
    DashboardModule,
    OpsModule,
    EventsModule,
    AuditModule,
  ],
})
export class AppModule {}
