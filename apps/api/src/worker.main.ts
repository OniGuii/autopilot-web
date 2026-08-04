import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { QueueModule } from './modules/async/queue.module';
import { WorkerModule } from './modules/async/worker.module';
import {
  shutdownOpenTelemetry,
  startOpenTelemetry,
} from './observability/otel.bootstrap';
import { ObservabilityModule } from './observability/observability.module';
import { StructuredLogger } from './observability/structured-logger';
import { PrismaModule } from './prisma/prisma.module';
import { SharedModule } from './shared/shared.module';

/**
 * Dedicated worker process (A2).
 * Run: `node dist/worker.main` or `npm run start:worker`
 */
@Module({
  imports: [
    AppConfigModule,
    SharedModule,
    PrismaModule,
    ObservabilityModule,
    QueueModule,
    WorkerModule,
  ],
})
class WorkerAppModule {}

async function bootstrap() {
  startOpenTelemetry();
  const logger = new StructuredLogger();
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    logger,
  });
  app.enableShutdownHooks();
  process.once('beforeExit', () => {
    void shutdownOpenTelemetry();
  });
  Logger.log(
    'AutoPilot workers running (whatsapp-inbound, followup-scheduler, reconcile-worker, ai-suggestions)',
    'WorkerBootstrap',
  );
}

void bootstrap();
