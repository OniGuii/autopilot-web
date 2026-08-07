import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { AiRecoveryDashboardService } from './ai-recovery-dashboard.service';
import { AiRecoverySettingsService } from './ai-recovery-settings.service';
import { UpdateRecoverySettingsDto } from './dto/update-recovery-settings.dto';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('ai/recovery')
export class AiRecoveryController {
  constructor(
    private readonly settings: AiRecoverySettingsService,
    private readonly dashboard: AiRecoveryDashboardService,
  ) {}

  @Get('settings')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Get Recovery Engine settings (11D)' })
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getOrCreate(this.actor(user));
  }

  @Patch('settings')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Update Recovery Engine settings (11D)' })
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateRecoverySettingsDto,
    @Req() req: Request,
  ) {
    return this.settings.update(this.actor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('dashboard')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Recovery operational dashboard (11D)' })
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.getOverview(this.actor(user));
  }

  private actor(user: AuthenticatedUser) {
    if (!user.cid || !user.sub) throw new Error('Company context required');
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
