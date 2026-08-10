import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OutboundFirstTouchController } from './outbound-first-touch.controller';
import { OutboundFirstTouchService } from './outbound-first-touch.service';
import { OutboundImportController } from './outbound-import.controller';
import { OutboundImportService } from './outbound-import.service';
import { OutboundProtectionController } from './outbound-protection.controller';
import { OutboundProtectionDashboardService } from './outbound-protection-dashboard.service';
import { OutboundProtectionService } from './outbound-protection.service';
import { OutboundProtectionSettingsService } from './outbound-protection-settings.service';
import { OutboundSuppressService } from './outbound-suppress.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [
    OutboundProtectionController,
    OutboundImportController,
    OutboundFirstTouchController,
  ],
  providers: [
    OutboundProtectionSettingsService,
    OutboundSuppressService,
    OutboundProtectionService,
    OutboundProtectionDashboardService,
    OutboundImportService,
    OutboundFirstTouchService,
  ],
  exports: [
    OutboundProtectionService,
    OutboundProtectionSettingsService,
    OutboundSuppressService,
    OutboundImportService,
    OutboundFirstTouchService,
  ],
})
export class OutboundModule {}
