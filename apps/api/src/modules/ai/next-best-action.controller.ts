import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { NextBestActionService } from './next-best-action.service';

/**
 * 11E.4 — Next Best Action (read-only product surfaces + admin dashboard).
 */
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('ai/nba')
export class NextBestActionController {
  constructor(private readonly nba: NextBestActionService) {}

  @Get('dashboard')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Fase 11E.4 — top ações NBA, conversões e HOT/WARM/COLD por ação.',
  })
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.nba.getDashboard(this.actor(user));
  }

  @Get('conversation/:conversationId')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({
    summary: 'Fase 11E.4 — próxima ação recomendada (somente leitura).',
  })
  getForConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.nba.getForConversation(this.actor(user), conversationId);
  }

  @Get('lead/:leadId')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({
    summary: 'Fase 11E.4 — próxima ação recomendada do lead (somente leitura).',
  })
  getForLead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
  ) {
    return this.nba.getForLead(this.actor(user), leadId);
  }

  private actor(user: AuthenticatedUser) {
    if (!user.cid || !user.sub) throw new Error('Company context required');
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
