import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { LeadScoringService } from './lead-scoring.service';

/**
 * 11E.2 — Lead Scoring metrics (backend only, no product UI).
 */
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('ai/lead-scoring')
export class LeadScoringController {
  constructor(private readonly scoring: LeadScoringService) {}

  @Get('dashboard')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary:
      'Fase 11E.2 — contagens HOT/WARM/COLD e conversões por temperatura.',
  })
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.scoring.getDashboard(this.actor(user));
  }

  private actor(user: AuthenticatedUser) {
    if (!user.cid || !user.sub) throw new Error('Company context required');
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
