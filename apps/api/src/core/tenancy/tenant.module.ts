import { Module } from '@nestjs/common';
import { TenantContext } from './tenant.context';
import { TenantGuard } from './tenant.guard';
import { TenantInterceptor } from './tenant.interceptor';

@Module({
  providers: [TenantContext, TenantGuard, TenantInterceptor],
  exports: [TenantContext, TenantGuard, TenantInterceptor],
})
export class TenantModule {}
