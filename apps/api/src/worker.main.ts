import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { SharedModule } from './shared/shared.module';
import { QueueModule } from './modules/async/queue.module';
import { WorkerModule } from './modules/async/worker.module';

/**
 * Dedicated worker process (A2).
 * Run: `node dist/worker.main` or `npm run start:worker`
 */
@Module({
  imports: [
    AppConfigModule,
    SharedModule,
    PrismaModule,
    QueueModule,
    WorkerModule,
  ],
})
class WorkerAppModule {}

async function bootstrap() {
  const logger = new Logger('WorkerBootstrap');
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.enableShutdownHooks();
  logger.log(
    'AutoPilot workers running (whatsapp-inbound, followup-scheduler, reconcile-worker, ai-suggestions)',
  );
}

void bootstrap();
