import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantInterceptor } from './tenancy/tenant.interceptor';
import { TenantModule } from './tenancy/tenant.module';

@Global()
@Module({
  imports: [TenantModule],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
  ],
  exports: [TenantModule],
})
export class CoreModule {}
