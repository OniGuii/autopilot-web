import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { CreateOutboundSuppressDto } from './dto/create-outbound-suppress.dto';
import { ListOutboundSuppressQueryDto } from './dto/list-outbound-suppress.query.dto';
import { UpdateOutboundProtectionSettingsDto } from './dto/update-outbound-protection-settings.dto';
import { OutboundProtectionDashboardService } from './outbound-protection-dashboard.service';
import { OutboundProtectionSettingsService } from './outbound-protection-settings.service';
import { OutboundSuppressService } from './outbound-suppress.service';

@ApiTags('outbound')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('outbound/protection')
export class OutboundProtectionController {
  constructor(
    private readonly settings: OutboundProtectionSettingsService,
    private readonly suppress: OutboundSuppressService,
    private readonly dashboard: OutboundProtectionDashboardService,
  ) {}

  @Get('settings')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Get Outbound Protection settings (V1.1)' })
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getOrCreate(this.actor(user));
  }

  @Patch('settings')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Update Outbound Protection settings (V1.1)' })
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOutboundProtectionSettingsDto,
    @Req() req: Request,
  ) {
    return this.settings.update(this.actor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('dashboard')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Outbound Protection operational dashboard (V1.1)' })
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.getOverview(this.actor(user));
  }

  @Get('suppress')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'List suppress / opt-out entries' })
  listSuppress(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOutboundSuppressQueryDto,
  ) {
    return this.suppress.list(this.actor(user), query);
  }

  @Post('suppress')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Add phone to suppress list' })
  addSuppress(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOutboundSuppressDto,
    @Req() req: Request,
  ) {
    return this.suppress.addManual(this.actor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('suppress/:id')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Deactivate suppress entry' })
  removeSuppress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.suppress.remove(this.actor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private actor(user: AuthenticatedUser) {
    if (!user.cid || !user.sub) throw new Error('Company context required');
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
