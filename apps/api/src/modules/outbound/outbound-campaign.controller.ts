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
import {
  AddCampaignLeadsDto,
  AttachImportBatchDto,
  GenerateCampaignFirstTouchDto,
  RemoveCampaignLeadsDto,
} from './dto/campaign-leads.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { OutboundCampaignService } from './outbound-campaign.service';

@ApiTags('outbound')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('outbound/campaigns')
export class OutboundCampaignController {
  constructor(private readonly campaigns: OutboundCampaignService) {}

  @Get('dashboard')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Campaign rollup dashboard (V1.4A)' })
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.campaigns.getDashboard(this.actor(user));
  }

  @Get()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'List campaigns' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.campaigns.list(this.actor(user), {
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Create campaign (DRAFT)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCampaignDto,
    @Req() req: Request,
  ) {
    return this.campaigns.create(this.actor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get(':id')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Get campaign detail + metrics' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.getById(this.actor(user), id);
  }

  @Patch(':id')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Update campaign fields' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
    @Req() req: Request,
  ) {
    return this.campaigns.update(this.actor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/ready')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  ready(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.campaigns.transition(this.actor(user), id, 'ready', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/start')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.campaigns.transition(this.actor(user), id, 'start', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/pause')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.campaigns.transition(this.actor(user), id, 'pause', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/resume')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.campaigns.transition(this.actor(user), id, 'resume', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/complete')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.campaigns.transition(this.actor(user), id, 'complete', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/archive')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.campaigns.transition(this.actor(user), id, 'archive', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get(':id/leads')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  listLeads(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.campaigns.listLeads(this.actor(user), id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post(':id/leads')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Add leads to campaign' })
  addLeads(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCampaignLeadsDto,
    @Req() req: Request,
  ) {
    return this.campaigns.addLeads(this.actor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/leads/remove')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Remove leads from campaign' })
  removeLeads(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveCampaignLeadsDto,
    @Req() req: Request,
  ) {
    return this.campaigns.removeLeads(this.actor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/attach-import')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Add all leads from a completed import batch' })
  attachImport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachImportBatchDto,
    @Req() req: Request,
  ) {
    return this.campaigns.attachImportBatch(this.actor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/first-touch/generate')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Generate First Touch D0 for eligible campaign leads (RUNNING)',
  })
  generateFirstTouch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateCampaignFirstTouchDto,
    @Req() req: Request,
  ) {
    return this.campaigns.generateFirstTouch(this.actor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private actor(user: AuthenticatedUser) {
    return { cid: user.cid!, sub: user.sub };
  }
}
