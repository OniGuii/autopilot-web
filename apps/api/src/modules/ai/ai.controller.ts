import {
  Body,
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
import { AiDashboardService } from './ai-dashboard.service';
import { AiIntentService } from './ai-intent.service';
import { AiService } from './ai.service';
import { ClassifyIntentDto } from './dto/classify-intent.dto';
import { SuggestReplyDto } from './dto/suggest-reply.dto';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly intentService: AiIntentService,
    private readonly dashboard: AiDashboardService,
  ) {}

  @Get('dashboard')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary:
      'Fase 11C — métricas do agente (auto-replies, escaladas, taxa de automação).',
  })
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.getOverview(this.asCompanyActor(user));
  }

  @Post('conversations/:conversationId/suggest')
  @HttpCode(HttpStatus.OK)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({
    summary:
      'Gera sugestão de resposta via IA e persiste como FollowUp SUGGESTED (AI_REPLY). Com ASYNC_AI_ENABLED=true retorna accepted + jobId.',
  })
  suggest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SuggestReplyDto,
    @Req() req: Request,
  ) {
    return this.aiService.suggestForConversation(
      this.asCompanyActor(user),
      conversationId,
      dto,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
  }

  @Post('classify')
  @HttpCode(HttpStatus.OK)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiOperation({
    summary:
      'Fase 11A — classifica intent + regras de escalonamento (não envia WhatsApp).',
  })
  classify(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClassifyIntentDto,
    @Req() req: Request,
  ) {
    const actor = this.asCompanyActor(user);
    return this.intentService.classify({
      companyId: actor.cid,
      message: dto.message,
      recentContext: dto.recentContext,
      actorUserId: actor.sub,
      meta: { ip: req.ip, userAgent: req.headers['user-agent'] },
    });
  }

  private asCompanyActor(user: AuthenticatedUser) {
    if (!user.cid || !user.sub) {
      throw new Error('Company context required');
    }
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
