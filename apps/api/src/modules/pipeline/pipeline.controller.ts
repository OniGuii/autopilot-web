import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { DashboardQueryDto } from '../dashboard/dto/dashboard-query.dto';
import { PipelineService } from './pipeline.service';

@ApiTags('pipeline')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
@Controller('pipeline')
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Get()
  @ApiOperation({
    summary: 'Operational pipeline KPIs (funnel + ownership hygiene)',
  })
  getPipeline(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.pipelineService.getPipeline(
      user as AuthenticatedUser & { cid: string },
      query,
    );
  }
}
