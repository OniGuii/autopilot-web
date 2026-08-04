import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, ConversationStatus, FollowUpStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import { AiSuggestionProducer } from '../async/producers/ai-suggestion.producer';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { newCorrelationId } from '../whatsapp/correlation';
import {
  AI_CONTEXT_MAX_CHARS,
  AI_CONTEXT_MAX_MESSAGES,
  AI_FOLLOWUP_TYPE,
  AI_GENERATION_LOCK_PREFIX,
  AI_GENERATION_LOCK_TTL_MS,
  AI_METADATA_SOURCE,
  AI_MSG_BODY_MAX_CHARS,
  AI_PROMPT_VERSION,
  AI_RATE_LIMIT_PER_DAY,
  AI_RATE_LIMIT_PER_MINUTE,
  AI_SUGGESTION_GENERATED,
  AI_SUGGESTION_MAX_CHARS,
  isAiFollowUpMetadata,
} from './ai.constants';
import { SuggestReplyDto } from './dto/suggest-reply.dto';
import { OpenAiClient } from './openai.client';
import {
  SUGGEST_REPLY_SYSTEM_PROMPT,
  buildSuggestUserPrompt,
  type SuggestPromptTone,
} from './prompts/suggest-reply.prompt';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

type AiMetadata = {
  source: typeof AI_METADATA_SOURCE;
  model: string;
  promptVersion: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  generatedAt: string;
  tone: SuggestPromptTone;
  instruction?: string;
  attemptCount: number;
};

type SuggestSyncResult = {
  ok: true;
  conversationId: string;
  leadId: string;
  followUpId: string;
  suggestion: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

type SuggestAcceptedResult = {
  ok: true;
  accepted: true;
  conversationId: string;
  correlationId: string;
  jobId: string;
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly asyncAiEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly openai: OpenAiClient,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    @Optional()
    private readonly aiSuggestionProducer?: AiSuggestionProducer,
  ) {
    this.asyncAiEnabled =
      this.config.get<boolean>('async.aiEnabled', false) === true;
  }

  /**
   * HTTP entry. Flag off → sync (comportamento atual).
   * Flag on → cria solicitação, enqueue, retorna accepted.
   */
  async suggestForConversation(
    actor: CompanyActor,
    conversationId: string,
    dto: SuggestReplyDto,
    meta?: RequestMeta,
  ): Promise<SuggestSyncResult | SuggestAcceptedResult> {
    if (this.asyncAiEnabled) {
      return this.acceptSuggestRequest(actor, conversationId, dto, meta);
    }
    return this.runSuggest(actor, conversationId, dto, meta);
  }

  /**
   * Worker entry (7.2C) — always runs sync generation (ignores async flag).
   */
  async processSuggestJob(input: {
    companyId: string;
    actorUserId: string;
    conversationId: string;
    dto: SuggestReplyDto;
    meta?: RequestMeta;
  }): Promise<SuggestSyncResult> {
    const actor = {
      cid: input.companyId,
      sub: input.actorUserId,
    } as CompanyActor;
    return this.runSuggest(actor, input.conversationId, input.dto, input.meta);
  }

  /** Exposto para testes / callers sem acoplar a constants. */
  static isAiFollowUp(metadata: unknown): boolean {
    return isAiFollowUpMetadata(metadata);
  }

  private async acceptSuggestRequest(
    actor: CompanyActor,
    conversationId: string,
    dto: SuggestReplyDto,
    meta?: RequestMeta,
  ): Promise<SuggestAcceptedResult> {
    const companyId = actor.cid;
    if (!companyId) {
      throw new ForbiddenException('Token sem companyId (cid)');
    }
    if (!this.aiSuggestionProducer) {
      throw new ServiceUnavailableException(
        'Async AI enabled but producer is unavailable',
      );
    }

    await this.assertConversationReady(companyId, conversationId);
    await this.assertRateLimits(companyId);

    const correlationId = newCorrelationId();
    try {
      const { jobId, deduped } = await this.aiSuggestionProducer.enqueue({
        v: 1,
        companyId,
        conversationId,
        actorUserId: actor.sub,
        correlationId,
        ...(dto.tone ? { tone: dto.tone } : {}),
        ...(dto.instruction ? { instruction: dto.instruction } : {}),
        ...(meta?.ip ? { ip: meta.ip } : {}),
        ...(meta?.userAgent ? { userAgent: meta.userAgent } : {}),
      });

      if (deduped) {
        throw new ConflictException(
          'Já existe uma geração de sugestão IA em andamento para esta Conversation',
        );
      }

      return {
        ok: true,
        accepted: true,
        conversationId,
        correlationId,
        jobId,
      };
    } catch (err) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof NotFoundException ||
        err instanceof ForbiddenException ||
        err instanceof HttpException
      ) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `ai suggest enqueue failed conversation=${conversationId}: ${message}`,
      );
      throw new ServiceUnavailableException(
        'Failed to enqueue AI suggestion for async processing',
      );
    }
  }

  private async runSuggest(
    actor: CompanyActor,
    conversationId: string,
    dto: SuggestReplyDto,
    meta?: RequestMeta,
  ): Promise<SuggestSyncResult> {
    const companyId = actor.cid;
    if (!companyId) {
      throw new ForbiddenException('Token sem companyId (cid)');
    }

    const conversation = await this.assertConversationReady(
      companyId,
      conversationId,
    );

    const lockKey = `${AI_GENERATION_LOCK_PREFIX}${companyId}:${conversationId}`;
    const lockToken = await this.redis.tryAcquireLock(
      lockKey,
      AI_GENERATION_LOCK_TTL_MS,
    );
    if (!lockToken) {
      throw new ConflictException(
        'Já existe uma geração de sugestão IA em andamento para esta Conversation',
      );
    }

    try {
      await this.assertRateLimits(companyId);

      const messages = await this.prisma.message.findMany({
        where: { companyId, conversationId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: AI_CONTEXT_MAX_MESSAGES,
        select: {
          direction: true,
          body: true,
        },
      });
      const chronological = [...messages].reverse();
      const promptMessages = this.buildPromptMessages(chronological);
      if (promptMessages.length === 0) {
        throw new BadRequestException(
          'Conversation sem mensagens com texto para gerar sugestão',
        );
      }

      const tone: SuggestPromptTone = dto.tone ?? 'professional';
      const userPrompt = buildSuggestUserPrompt({
        lead: {
          name: conversation.lead.name,
          phone: conversation.lead.phone,
          status: conversation.lead.status,
          source: conversation.lead.source,
        },
        messages: promptMessages,
        tone,
        instruction: dto.instruction,
      });

      let completion;
      try {
        completion = await this.openai.chatCompletion([
          { role: 'system', content: SUGGEST_REPLY_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ]);
      } catch (err) {
        if (err instanceof ServiceUnavailableException) throw err;
        this.logger.error(
          `OpenAI falhou company=${companyId} conversation=${conversationId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new ServiceUnavailableException(
          'Falha ao gerar sugestão com o provedor de IA',
        );
      }

      let suggestedBody = completion.content.trim();
      if (!suggestedBody) {
        throw new ServiceUnavailableException(
          'Provedor de IA retornou resposta vazia',
        );
      }
      if (suggestedBody.length > AI_SUGGESTION_MAX_CHARS) {
        suggestedBody = suggestedBody.slice(0, AI_SUGGESTION_MAX_CHARS);
      }

      const metadata: AiMetadata = {
        source: AI_METADATA_SOURCE,
        model: completion.model,
        promptVersion: AI_PROMPT_VERSION,
        promptTokens: completion.usage.promptTokens,
        completionTokens: completion.usage.completionTokens,
        totalTokens: completion.usage.totalTokens,
        generatedAt: new Date().toISOString(),
        tone,
        attemptCount: 0,
        ...(dto.instruction ? { instruction: dto.instruction } : {}),
      };

      const followUp = await this.prisma.$transaction(async (tx) => {
        const created = await tx.followUp.create({
          data: {
            companyId,
            conversationId,
            leadId: conversation.leadId,
            assignedUserId: actor.sub,
            type: AI_FOLLOWUP_TYPE,
            channel: Channel.WHATSAPP,
            status: FollowUpStatus.SUGGESTED,
            suggestedBody,
            metadata: metadata,
          },
        });

        await this.audit.write(tx, {
          companyId,
          actorUserId: actor.sub,
          action: AI_SUGGESTION_GENERATED,
          targetType: 'FOLLOWUP',
          targetId: created.id,
          before: null,
          after: {
            conversationId,
            leadId: conversation.leadId,
            followUpId: created.id,
            model: metadata.model,
            usage: {
              promptTokens: metadata.promptTokens,
              completionTokens: metadata.completionTokens,
              totalTokens: metadata.totalTokens,
            },
            suggestionPreview: suggestedBody.slice(0, 200),
          },
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });

        return created;
      });

      return {
        ok: true as const,
        conversationId,
        leadId: conversation.leadId,
        followUpId: followUp.id,
        suggestion: suggestedBody,
        model: metadata.model,
        usage: {
          promptTokens: metadata.promptTokens ?? 0,
          completionTokens: metadata.completionTokens ?? 0,
          totalTokens: metadata.totalTokens ?? 0,
        },
      };
    } finally {
      await this.redis.releaseLock(lockKey, lockToken);
    }
  }

  private async assertConversationReady(
    companyId: string,
    conversationId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, companyId, deletedAt: null },
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            status: true,
            source: true,
            deletedAt: true,
          },
        },
      },
    });
    if (!conversation || conversation.lead.deletedAt) {
      throw new NotFoundException('Conversation não encontrada');
    }
    if (
      conversation.status !== ConversationStatus.OPEN &&
      conversation.status !== ConversationStatus.IDLE
    ) {
      throw new BadRequestException(
        'Sugestão IA disponível apenas para Conversation OPEN ou IDLE',
      );
    }
    return conversation;
  }

  private buildPromptMessages(
    messages: Array<{ direction: string; body: string | null }>,
  ): Array<{ direction: string; body: string }> {
    const prepared: Array<{ direction: string; body: string }> = [];
    let total = 0;

    // Prioriza as mais recentes (já estão no fim após reverse cronológico).
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const raw = (messages[i].body ?? '').trim();
      if (!raw) continue;
      const body =
        raw.length > AI_MSG_BODY_MAX_CHARS
          ? `${raw.slice(0, AI_MSG_BODY_MAX_CHARS)}…`
          : raw;
      const lineCost = body.length + 1;
      if (total + lineCost > AI_CONTEXT_MAX_CHARS) {
        const remaining = AI_CONTEXT_MAX_CHARS - total - 1;
        if (remaining > 32) {
          prepared.unshift({
            direction: messages[i].direction,
            body: `${body.slice(0, remaining)}…`,
          });
        }
        break;
      }
      prepared.unshift({ direction: messages[i].direction, body });
      total += lineCost;
    }

    return prepared;
  }

  private async assertRateLimits(companyId: string): Promise<void> {
    const now = new Date();
    const minuteAgo = new Date(now.getTime() - 60_000);
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const [minuteCount, dayCount] = await Promise.all([
      this.countAiGenerations(companyId, minuteAgo),
      this.countAiGenerations(companyId, dayStart),
    ]);

    if (minuteCount >= AI_RATE_LIMIT_PER_MINUTE) {
      throw new HttpException(
        `Rate limit de IA atingido: máximo ${AI_RATE_LIMIT_PER_MINUTE} sugestões por minuto por company`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (dayCount >= AI_RATE_LIMIT_PER_DAY) {
      throw new HttpException(
        `Rate limit de IA atingido: máximo ${AI_RATE_LIMIT_PER_DAY} sugestões por dia por company`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async countAiGenerations(
    companyId: string,
    since: Date,
  ): Promise<number> {
    return this.prisma.followUp.count({
      where: {
        companyId,
        type: AI_FOLLOWUP_TYPE,
        createdAt: { gte: since },
        deletedAt: null,
        metadata: {
          path: ['source'],
          equals: AI_METADATA_SOURCE,
        },
      },
    });
  }
}
