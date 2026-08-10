import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OutboundProtectionController } from './outbound-protection.controller';
import { OutboundProtectionDashboardService } from './outbound-protection-dashboard.service';
import { OutboundProtectionService } from './outbound-protection.service';
import { OutboundProtectionSettingsService } from './outbound-protection-settings.service';
import { OutboundSuppressService } from './outbound-suppress.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [OutboundProtectionController],
  providers: [
    OutboundProtectionSettingsService,
    OutboundSuppressService,
    OutboundProtectionService,
    OutboundProtectionDashboardService,
  ],
  exports: [
    OutboundProtectionService,
    OutboundProtectionSettingsService,
    OutboundSuppressService,
  ],
})
export class OutboundModule {}
