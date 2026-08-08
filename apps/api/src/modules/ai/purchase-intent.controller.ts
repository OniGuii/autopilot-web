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
import { PurchaseIntentService } from './purchase-intent.service';

/**
 * 11E.5 — Purchase Intent (read-only product surfaces + admin dashboard).
 */
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('ai/purchase-intent')
export class PurchaseIntentController {
  constructor(private readonly purchaseIntent: PurchaseIntentService) {}

  @Get('dashboard')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary:
      'Fase 11E.5 — faixas VERY_HIGH…VERY_LOW, conversões e receita estimada.',
  })
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.purchaseIntent.getDashboard(this.actor(user));
  }

  @Get('conversation/:conversationId')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({
    summary: 'Fase 11E.5 — purchase intent da conversa (somente leitura).',
  })
  getForConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.purchaseIntent.getForConversation(
      this.actor(user),
      conversationId,
    );
  }

  @Get('lead/:leadId')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({
    summary: 'Fase 11E.5 — purchase intent do lead (somente leitura).',
  })
  getForLead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
  ) {
    return this.purchaseIntent.getForLead(this.actor(user), leadId);
  }

  private actor(user: AuthenticatedUser) {
    if (!user.cid || !user.sub) throw new Error('Company context required');
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
