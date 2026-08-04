import { Module } from '@nestjs/common';
import { AsyncModule } from '../async/async.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AuditAliasController } from './audit-alias.controller';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({
  imports: [AuthModule, AuditModule, WhatsappModule, AsyncModule],
  controllers: [OpsController, AuditAliasController],
  providers: [OpsService],
  exports: [OpsService],
})
export class OpsModule {}
