import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { BulkAssignLeadsDto } from './dto/bulk-assign-leads.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads.query.dto';
import { TimelineQueryDto } from './dto/timeline.query.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadTimelineService } from './lead-timeline.service';
import { LeadsService } from './leads.service';

@ApiTags('leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly timelineService: LeadTimelineService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create lead in current company (JWT.cid)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLeadDto,
    @Req() req: Request,
  ) {
    return this.leadsService.create(this.asCompanyActor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @ApiOperation({ summary: 'List leads with filters and pagination' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListLeadsQueryDto) {
    return this.leadsService.list(this.asCompanyActor(user), query);
  }

  @Post('bulk-assign')
  @HttpCode(HttpStatus.OK)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Bulk assign/unassign leads (OWNER|ADMIN; ownerId null = unassign)',
  })
  bulkAssign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkAssignLeadsDto,
    @Req() req: Request,
  ) {
    return this.leadsService.bulkAssign(this.asCompanyActor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lead by id' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leadsService.findOne(this.asCompanyActor(user), id);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Composed lead timeline (page/limit, occurredAt ASC)' })
  timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TimelineQueryDto,
  ) {
    return this.timelineService.getTimeline(this.asCompanyActor(user), id, query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partial update lead' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
    @Req() req: Request,
  ) {
    return this.leadsService.update(this.asCompanyActor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign lead owner (ACTIVE membership required)' })
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignLeadDto,
    @Req() req: Request,
  ) {
    return this.leadsService.assign(this.asCompanyActor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/unassign')
  @HttpCode(HttpStatus.OK)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Unassign lead owner (OWNER|ADMIN)' })
  unassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.leadsService.unassign(this.asCompanyActor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete lead (sets deleted_at)' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.leadsService.remove(this.asCompanyActor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private asCompanyActor(user: AuthenticatedUser) {
    // CompanyContextGuard guarantees cid/mid/role
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
