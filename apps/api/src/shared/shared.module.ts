import { Global, Module } from '@nestjs/common';
import { RedisModule } from './redis/redis.module';

/**
 * Shared utilities and reusable contracts (no domain business rules).
 */
@Global()
@Module({
  imports: [RedisModule],
  exports: [RedisModule],
})
export class SharedModule {}
