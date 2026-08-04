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
import { CreateMembershipDto } from './dto/create-membership.dto';
import { ListMembershipsQueryDto } from './dto/list-memberships.query.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { MembershipsService } from './memberships.service';

@ApiTags('memberships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('memberships')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({ summary: 'List company memberships' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMembershipsQueryDto,
  ) {
    return this.membershipsService.list(this.asActor(user), query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Invite member (D1: Membership INVITED, no temporary password)',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMembershipDto,
    @Req() req: Request,
  ) {
    return this.membershipsService.create(this.asActor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch(':id')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Change membership role' })
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMembershipDto,
    @Req() req: Request,
  ) {
    return this.membershipsService.updateRole(this.asActor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary:
      'Revoke membership in current company (D2 — not global user disable)',
  })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.membershipsService.revoke(this.asActor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private asActor(user: AuthenticatedUser) {
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
