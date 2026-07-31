import { Global, Module } from '@nestjs/common';
import { TenantModule } from './tenancy/tenant.module';

@Global()
@Module({
  imports: [TenantModule],
  exports: [TenantModule],
})
export class CoreModule {}
