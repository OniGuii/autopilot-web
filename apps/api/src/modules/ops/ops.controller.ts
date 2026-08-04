import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { ListAuditQueryDto } from './dto/list-audit.query.dto';
import { ListWebhooksQueryDto } from './dto/list-webhooks.query.dto';
import { ReconcileBodyDto } from './dto/reconcile-body.dto';
import { OpsService } from './ops.service';

@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('ops')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({ summary: 'Ops overview (metrics + alerts)' })
  getOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.opsService.getOverview(this.asCompanyActor(user));
  }

  @Get('metrics')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({ summary: 'Operational metrics for current company' })
  async getMetrics(@CurrentUser() user: AuthenticatedUser) {
    const metrics = await this.opsService.getMetrics(this.asCompanyActor(user));
    return {
      companyId: user.cid,
      generatedAt: new Date().toISOString(),
      ...metrics,
    };
  }

  @Get('alerts')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({ summary: 'Operational alerts for current company' })
  getAlerts(@CurrentUser() user: AuthenticatedUser) {
    return this.opsService.getAlerts(this.asCompanyActor(user));
  }

  @Get('health')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({
    summary:
      'Product health (Postgres, Redis, WhatsApp) — does not change /health',
  })
  getHealth(@CurrentUser() user: AuthenticatedUser) {
    return this.opsService.getHealth(this.asCompanyActor(user));
  }

  @Get('diagnostics')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({
    summary:
      'Pilot diagnostics (D3: OWNER|ADMIN full; AGENT limited — no openai/workers)',
  })
  getDiagnostics(@CurrentUser() user: AuthenticatedUser) {
    return this.opsService.getDiagnostics(this.asCompanyActor(user));
  }

  @Get('audit')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({ summary: 'Audit Explorer — list (occurredAt DESC)' })
  listAudit(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAuditQueryDto,
  ) {
    return this.opsService.listAudit(this.asCompanyActor(user), query);
  }

  @Get('audit/:id')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({ summary: 'Audit Explorer — get by id' })
  getAudit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.opsService.getAudit(this.asCompanyActor(user), id);
  }

  @Get('webhooks')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({ summary: 'Webhook Monitor — list (no replay)' })
  listWebhooks(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListWebhooksQueryDto,
  ) {
    return this.opsService.listWebhooks(this.asCompanyActor(user), query);
  }

  @Get('webhooks/:id')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({ summary: 'Webhook Monitor — get by id' })
  getWebhook(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.opsService.getWebhook(this.asCompanyActor(user), id);
  }

  @Post('reconcile/messages')
  @HttpCode(HttpStatus.OK)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary:
      'Reconcile stale PENDING outbound messages (dry-run default: apply=false)',
  })
  reconcileMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReconcileBodyDto,
    @Req() req: Request,
  ) {
    return this.opsService.reconcileMessages(
      this.asCompanyActor(user),
      body.apply === true,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  @Post('reconcile/followups')
  @HttpCode(HttpStatus.OK)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary:
      'Reconcile stale EXECUTING follow-ups (dry-run default: apply=false)',
  })
  reconcileFollowUps(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReconcileBodyDto,
    @Req() req: Request,
  ) {
    return this.opsService.reconcileFollowUps(
      this.asCompanyActor(user),
      body.apply === true,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  private asCompanyActor(user: AuthenticatedUser) {
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
