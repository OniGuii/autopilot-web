import {
  Body,
  Controller,
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
import { ApproveFollowUpDto } from './dto/approve-follow-up.dto';
import { CancelFollowUpDto } from './dto/cancel-follow-up.dto';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { ListFollowUpsQueryDto } from './dto/list-follow-ups.query.dto';
import { RejectFollowUpDto } from './dto/reject-follow-up.dto';
import { RescheduleFollowUpDto } from './dto/reschedule-follow-up.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
import { FollowUpService } from './follow-up.service';

@ApiTags('follow-ups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
@Controller('follow-ups')
export class FollowUpController {
  constructor(private readonly followUpService: FollowUpService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create follow-up suggestion (SUGGESTED)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFollowUpDto,
    @Req() req: Request,
  ) {
    return this.followUpService.create(this.asCompanyActor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @ApiOperation({
    summary: 'List follow-ups (ordered by scheduledAt ASC)',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFollowUpsQueryDto,
  ) {
    return this.followUpService.list(this.asCompanyActor(user), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get follow-up by id' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.followUpService.findOne(this.asCompanyActor(user), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update follow-up fields (audited)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFollowUpDto,
    @Req() req: Request,
  ) {
    return this.followUpService.update(this.asCompanyActor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve follow-up (SUGGESTED → SCHEDULED) — Phase 4 P4-A1',
  })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveFollowUpDto,
    @Req() req: Request,
  ) {
    return this.followUpService.approve(this.asCompanyActor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject follow-up (reason required)' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectFollowUpDto,
    @Req() req: Request,
  ) {
    return this.followUpService.reject(this.asCompanyActor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reschedule follow-up (APPROVED|SCHEDULED → SCHEDULED)',
  })
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleFollowUpDto,
    @Req() req: Request,
  ) {
    return this.followUpService.reschedule(this.asCompanyActor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel follow-up (SUGGESTED|APPROVED|SCHEDULED → CANCELLED). Not EXECUTED.',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelFollowUpDto,
    @Req() req: Request,
  ) {
    return this.followUpService.cancel(this.asCompanyActor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Execute SCHEDULED follow-up via WhatsApp Outbound Engine (EXECUTING → EXECUTED|FAILED)',
  })
  execute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.followUpService.execute(this.asCompanyActor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Retry FAILED follow-up (max 3 attempts). Creates a new OUTBOUND Message.',
  })
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.followUpService.retry(this.asCompanyActor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private asCompanyActor(user: AuthenticatedUser) {
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
