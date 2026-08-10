import {
  Body,
  Controller,
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
import { GenerateFirstTouchDto } from './dto/generate-first-touch.dto';
import { UpdateFirstTouchSettingsDto } from './dto/update-first-touch-settings.dto';
import { OutboundFirstTouchService } from './outbound-first-touch.service';

@ApiTags('outbound')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('outbound/first-touch')
export class OutboundFirstTouchController {
  constructor(private readonly firstTouch: OutboundFirstTouchService) {}

  @Get('settings')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Get First Touch settings (V1.3)' })
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.firstTouch.getOrCreateSettings(this.actor(user));
  }

  @Patch('settings')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Update First Touch settings (V1.3)' })
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateFirstTouchSettingsDto,
    @Req() req: Request,
  ) {
    return this.firstTouch.updateSettings(this.actor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('dashboard')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'First Touch dashboard (V1.3)' })
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.firstTouch.getDashboard(this.actor(user));
  }

  @Get('follow-ups')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'List First Touch follow-ups' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.firstTouch.list(this.actor(user), {
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('generate')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Generate First Touch (D0) for eligible leads' })
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateFirstTouchDto,
    @Req() req: Request,
  ) {
    return this.firstTouch.generate(this.actor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('follow-ups/:id/approve')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Approve SUGGESTED First Touch → SCHEDULED' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.firstTouch.approve(this.actor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('follow-ups/:id/reject')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Reject First Touch follow-up' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.firstTouch.reject(this.actor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private actor(user: AuthenticatedUser) {
    return { cid: user.cid!, sub: user.sub };
  }
}
