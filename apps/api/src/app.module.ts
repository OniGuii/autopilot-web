import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { CoreModule } from './core/core.module';
import { AsyncModule } from './modules/async/async.module';
import { WorkerModule } from './modules/async/worker.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AiModule } from './modules/ai/ai.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EventsModule } from './modules/events/events.module';
import { ExportsModule } from './modules/exports/exports.module';
import { FollowUpModule } from './modules/follow-up/follow-up.module';
import { HealthModule } from './modules/health/health.module';
import { LeadsModule } from './modules/leads/leads.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { OpsModule } from './modules/ops/ops.module';
import { OutboundModule } from './modules/outbound/outbound.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { SetupModule } from './modules/setup/setup.module';
import { UsersModule } from './modules/users/users.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { ObservabilityModule } from './observability/observability.module';
import { PrismaModule } from './prisma/prisma.module';
import { SharedModule } from './shared/shared.module';

/** A2 — workers in API process unless ASYNC_WORKERS_IN_API=false. */
const workersInApi = (process.env.ASYNC_WORKERS_IN_API ?? 'true') === 'true';

@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: config.get<number>('throttle.ttlMs', 60_000),
          limit: config.get<number>('throttle.limit', 120),
        },
      ],
    }),
    CoreModule,
    SharedModule,
    PrismaModule,
    AsyncModule,
    ...(workersInApi ? [WorkerModule] : []),
    HealthModule,
    AuthModule,
    CompaniesModule,
    UsersModule,
    MembershipsModule,
    SetupModule,
    ExportsModule,
    LeadsModule,
    ConversationsModule,
    WhatsappModule,
    AiModule,
    OutboundModule,
    FollowUpModule,
    DashboardModule,
    PipelineModule,
    OpsModule,
    EventsModule,
    AuditModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
