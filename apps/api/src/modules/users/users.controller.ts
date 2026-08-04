import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id/sessions')
  @ApiOperation({
    summary: 'List active sessions for user in current company (D2 scoped)',
  })
  listSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.listSessions(this.asActor(user), id);
  }

  @Post(':id/logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke sessions for user in current company only (D2)',
  })
  logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.usersService.logoutAllInCompany(this.asActor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/revoke-access')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Disable access to current company via membership revoke (D2 — not global)',
  })
  revokeAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.usersService.revokeAccess(this.asActor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private asActor(user: AuthenticatedUser) {
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
