import { Module } from '@nestjs/common';
import { QueueModule } from './queue.module';

/**
 * Fase 7.1 — Async Foundation (queues / producers / DLQ / metrics).
 * Workers are registered separately via WorkerModule (API or dedicated process).
 */
@Module({
  imports: [QueueModule],
  exports: [QueueModule],
})
export class AsyncModule {}
