import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { SalesMemoryService } from './sales-memory.service';

/**
 * 11E.1 — debug/internal Sales Memory endpoints (no product UI).
 */
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('ai/sales-memory')
export class SalesMemoryController {
  constructor(private readonly salesMemory: SalesMemoryService) {}

  @Get(':conversationId')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary:
      'Debug — carrega Sales Memory da conversa (Conversation.metadata.salesMemory).',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.salesMemory.getForDebug(this.actor(user), conversationId);
  }

  @Delete(':conversationId')
  @HttpCode(HttpStatus.OK)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary:
      'Debug — limpa Sales Memory da conversa (audit SALES_MEMORY_CLEARED).',
  })
  clear(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    const actor = this.actor(user);
    return this.salesMemory.clearMemory({
      companyId: actor.cid,
      conversationId,
      actorUserId: actor.sub,
    });
  }

  private actor(user: AuthenticatedUser) {
    if (!user.cid || !user.sub) throw new Error('Company context required');
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
