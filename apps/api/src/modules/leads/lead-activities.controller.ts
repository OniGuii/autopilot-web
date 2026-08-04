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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import { ListLeadActivitiesQueryDto } from './dto/list-lead-activities.query.dto';
import { UpdateLeadActivityDto } from './dto/update-lead-activity.dto';
import { LeadActivitiesService } from './lead-activities.service';

@ApiTags('lead-activities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
@Controller('leads/:leadId/activities')
export class LeadActivitiesController {
  constructor(private readonly activitiesService: LeadActivitiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create activity on lead' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: CreateLeadActivityDto,
    @Req() req: Request,
  ) {
    return this.activitiesService.create(this.asActor(user), leadId, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @ApiOperation({ summary: 'List activities for lead' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Query() query: ListLeadActivitiesQueryDto,
  ) {
    return this.activitiesService.list(this.asActor(user), leadId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get activity by id' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.activitiesService.findOne(this.asActor(user), leadId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update activity (PLANNED only for status)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadActivityDto,
    @Req() req: Request,
  ) {
    return this.activitiesService.update(this.asActor(user), leadId, id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark activity DONE + completedAt' })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.activitiesService.complete(this.asActor(user), leadId, id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark activity CANCELLED' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.activitiesService.cancel(this.asActor(user), leadId, id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete activity' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.activitiesService.remove(this.asActor(user), leadId, id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private asActor(user: AuthenticatedUser) {
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
