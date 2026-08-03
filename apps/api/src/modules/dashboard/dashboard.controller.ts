import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Full dashboard KPIs for current company' })
  getFull(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getFull(this.asCompanyActor(user), query);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Overview lead KPIs' })
  getOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.withMeta(
      user,
      query,
      this.dashboardService.getOverview(this.asCompanyActor(user), query),
    );
  }

  @Get('leads')
  @ApiOperation({ summary: 'Leads grouped by status' })
  getLeads(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.withMeta(
      user,
      query,
      this.dashboardService.getLeads(this.asCompanyActor(user), query),
    );
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Conversation and message KPIs' })
  getConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.withMeta(
      user,
      query,
      this.dashboardService.getConversations(this.asCompanyActor(user), query),
    );
  }

  @Get('followups')
  @ApiOperation({ summary: 'Follow-up KPIs (overdue ignores period)' })
  getFollowUps(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.withMeta(
      user,
      query,
      this.dashboardService.getFollowUps(this.asCompanyActor(user), query),
    );
  }

  private async withMeta<T extends object>(
    user: AuthenticatedUser,
    query: DashboardQueryDto,
    dataPromise: Promise<T>,
  ) {
    const data = await dataPromise;
    return {
      companyId: user.cid,
      generatedAt: new Date().toISOString(),
      ...data,
    };
  }

  private asCompanyActor(user: AuthenticatedUser) {
    return user as AuthenticatedUser & { cid: string };
  }
}
