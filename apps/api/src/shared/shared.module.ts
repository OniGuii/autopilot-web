import { Global, Module } from '@nestjs/common';

/**
 * Shared utilities and reusable contracts (no domain business rules).
 */
@Global()
@Module({})
export class SharedModule {}
