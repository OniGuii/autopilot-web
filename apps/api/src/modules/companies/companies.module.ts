import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanySettingsController } from './company-settings.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CompaniesController, CompanySettingsController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
