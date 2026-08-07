import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AiAgentMode,
  AiIntent,
  Channel,
  FollowUpStatus,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import {
  AI_ASSIST_MODEL,
  AI_ASSIST_PIPELINE,
  AI_ASSIST_PROMPT_VERSION,
  AI_ESCALATED,
  AI_FOLLOWUP_TYPE,
  AI_INTENT_CLASSIFIED,
  AI_KB_MATCH_FOUND,
  AI_KB_MATCH_MISSED,
  AI_METADATA_SOURCE,
  AI_RESPONSE_GENERATED,
  AI_SUGGESTION_MAX_CHARS,
} from './ai.constants';
import { AiIntentService } from './ai-intent.service';
import { KnowledgeBaseResolver } from './knowledge-base-resolver.service';

export type AssistInboundInput = {
  companyId: string;
  conversationId: string;
  leadId: string;
  messageId: string;
  messageBody: string;
};

export type AssistPipelineResult = {
  skipped: boolean;
  reason?: string;
  followUpId?: string;
  intent?: AiIntent;
  requiresHuman?: boolean;
  /** Always false in 11B — guardrail against auto-send. */
  whatsappSent: false;
};

type AssistMetadata = {
  source: typeof AI_METADATA_SOURCE;
  pipeline: typeof AI_ASSIST_PIPELINE;
  model: typeof AI_ASSIST_MODEL;
  promptVersion: typeof AI_ASSIST_PROMPT_VERSION;
  intent: AiIntent;
  confidence: number;
  requiresHuman: boolean;
  escalationReason: string | null;
  kb: {
    hit: boolean;
    entryId?: string;
    title?: string;
    kind?: string;
    confidence?: number;
    source?: string | null;
  };
  inboundMessageId: string;
  generatedAt: string;
  attemptCount: number;
  autoSend: false;
};

@Injectable()
export class AiAssistPipelineService {
  private readonly logger = new Logger(AiAssistPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly intentService: AiIntentService,
    private readonly kbResolver: KnowledgeBaseResolver,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  /**
   * Pós-inbound ASSIST (11B): classifica → KB → FollowUp SUGGESTED.
   * Nunca envia WhatsApp. Erros são engolidos pelo caller (webhook rápido).
   */
  async handleInbound(
    input: AssistInboundInput,
  ): Promise<AssistPipelineResult> {
    const mode = await this.resolveMode(input.companyId);
    if (mode === AiAgentMode.OFF) {
      return { skipped: true, reason: 'AGENT_MODE_OFF', whatsappSent: false };
    }

    // AUTO is stored but must not send until 11C — degrade to ASSIST path.
    if (mode === AiAgentMode.AUTO) {
      this.logger.debug(
        `company=${input.companyId} mode=AUTO degraded to ASSIST (11B no auto-send)`,
      );
    }

    const existing = await this.prisma.followUp.findFirst({
      where: {
        companyId: input.companyId,
        conversationId: input.conversationId,
        deletedAt: null,
        type: AI_FOLLOWUP_TYPE,
        metadata: {
          path: ['inboundMessageId'],
          equals: input.messageId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return {
        skipped: true,
        reason: 'ALREADY_PROCESSED',
        followUpId: existing.id,
        whatsappSent: false,
      };
    }

    const message = input.messageBody?.trim() ?? '';
    const classification = await this.intentService.classify({
      companyId: input.companyId,
      message,
      audit: false,
    });

    const kb = await this.kbResolver.resolve({
      companyId: input.companyId,
      intent: classification.intent,
      message,
    });

    const kbRequired = this.intentService.intentRequiresKb(
      classification.intent,
    );
    const kbHit = Boolean(kb.bestMatch);
    const escalation = this.intentService.evaluateEscalation(
      classification.intent,
      kbHit,
      kbRequired,
    );
    const requiresHuman = escalation.escalated;

    this.prom?.recordAiIntent(classification.intent);
    if (kbHit) {
      this.prom?.recordAiKbHit();
    } else if (kbRequired) {
      this.prom?.recordAiKbMiss();
    }
    if (requiresHuman) this.prom?.recordAiResponseEscalated();

    const suggestedBody = this.buildSuggestedBody({
      intent: classification.intent,
      requiresHuman,
      escalationReason: escalation.escalationReason,
      kbTitle: kb.bestMatch?.title,
      kbBody: kb.bestMatch?.body,
    });

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        companyId: input.companyId,
        deletedAt: null,
      },
      select: {
        id: true,
        assignedUserId: true,
        lead: { select: { ownerId: true } },
      },
    });
    if (!conversation) {
      return {
        skipped: true,
        reason: 'CONVERSATION_NOT_FOUND',
        whatsappSent: false,
      };
    }

    const assignedUserId =
      conversation.assignedUserId ?? conversation.lead.ownerId ?? null;

    const metadata: AssistMetadata = {
      source: AI_METADATA_SOURCE,
      pipeline: AI_ASSIST_PIPELINE,
      model: AI_ASSIST_MODEL,
      promptVersion: AI_ASSIST_PROMPT_VERSION,
      intent: classification.intent,
      confidence: classification.confidence,
      requiresHuman,
      escalationReason: escalation.escalationReason,
      kb: {
        hit: kbHit,
        ...(kb.bestMatch
          ? {
              entryId: kb.bestMatch.id,
              title: kb.bestMatch.title,
              kind: kb.bestMatch.kind,
              confidence: kb.confidence,
              source: kb.source,
            }
          : { confidence: kb.confidence, source: kb.source }),
      },
      inboundMessageId: input.messageId,
      generatedAt: new Date().toISOString(),
      attemptCount: 0,
      autoSend: false,
    };

    const followUp = await this.prisma.$transaction(async (tx) => {
      await this.writePipelineAudits(tx, input, {
        intent: classification.intent,
        confidence: classification.confidence,
        rationale: classification.rationale,
        requiresHuman,
        escalationReason: escalation.escalationReason,
        kbHit,
        kb,
        suggestedBody,
      });

      // Persist classification on inbound message for timeline/debug.
      const msg = await tx.message.findFirst({
        where: {
          id: input.messageId,
          companyId: input.companyId,
          deletedAt: null,
        },
        select: { id: true, metadata: true },
      });
      if (msg) {
        const prev =
          msg.metadata &&
          typeof msg.metadata === 'object' &&
          !Array.isArray(msg.metadata)
            ? (msg.metadata as Record<string, unknown>)
            : {};
        await tx.message.update({
          where: { id: msg.id },
          data: {
            metadata: {
              ...prev,
              aiIntent: {
                intent: classification.intent,
                confidence: classification.confidence,
                requiresHuman,
                escalationReason: escalation.escalationReason,
                classifiedAt: new Date().toISOString(),
                pipeline: AI_ASSIST_PIPELINE,
              },
            },
          },
        });
      }

      return tx.followUp.create({
        data: {
          companyId: input.companyId,
          conversationId: input.conversationId,
          leadId: input.leadId,
          assignedUserId,
          type: AI_FOLLOWUP_TYPE,
          channel: Channel.WHATSAPP,
          status: FollowUpStatus.SUGGESTED,
          suggestedBody,
          metadata,
        },
      });
    });

    this.prom?.recordAiResponseGenerated();

    return {
      skipped: false,
      followUpId: followUp.id,
      intent: classification.intent,
      requiresHuman,
      whatsappSent: false,
    };
  }

  private async resolveMode(companyId: string): Promise<AiAgentMode> {
    const row = await this.prisma.companyAiSettings.findFirst({
      where: { companyId, deletedAt: null },
      select: { mode: true },
    });
    return row?.mode ?? AiAgentMode.ASSIST;
  }

  private buildSuggestedBody(input: {
    intent: AiIntent;
    requiresHuman: boolean;
    escalationReason: string | null;
    kbTitle?: string;
    kbBody?: string;
  }): string {
    let body: string;
    if (!input.requiresHuman && input.kbTitle && input.kbBody) {
      body = [
        'Olá! Sobre a sua dúvida:',
        '',
        input.kbTitle,
        input.kbBody,
        '',
        'Se quiser, posso detalhar mais ou te conectar com um atendente.',
      ].join('\n');
    } else if (input.requiresHuman && input.kbTitle && input.kbBody) {
      body = [
        'Olá! Encontrei esta informação na nossa base, mas prefiro que um atendente confirme com você:',
        '',
        input.kbTitle,
        input.kbBody,
        '',
        'Vou encaminhar para um humano continuar o atendimento.',
      ].join('\n');
    } else if (
      input.escalationReason === 'COMPLAINT' ||
      input.intent === AiIntent.COMPLAINT
    ) {
      body =
        'Sinto muito pelo ocorrido. Vou encaminhar sua mensagem para um atendente humano agora para cuidar disso com prioridade.';
    } else if (
      input.escalationReason === 'HUMAN' ||
      input.intent === AiIntent.HUMAN
    ) {
      body =
        'Claro — vou te conectar com um atendente humano. Em instantes alguém da equipe assume a conversa.';
    } else if (input.escalationReason?.endsWith('_WITHOUT_KB')) {
      body =
        'Obrigado pela mensagem! Vou confirmar esse detalhe com a equipe e um atendente retorna em seguida com a informação correta.';
    } else {
      body =
        'Obrigado pelo contato. Vou pedir para um atendente humano continuar essa conversa com você.';
    }

    if (body.length > AI_SUGGESTION_MAX_CHARS) {
      return body.slice(0, AI_SUGGESTION_MAX_CHARS);
    }
    return body;
  }

  private async writePipelineAudits(
    tx: Prisma.TransactionClient,
    input: AssistInboundInput,
    ctx: {
      intent: AiIntent;
      confidence: number;
      rationale: string;
      requiresHuman: boolean;
      escalationReason: string | null;
      kbHit: boolean;
      kb: Awaited<ReturnType<KnowledgeBaseResolver['resolve']>>;
      suggestedBody: string;
    },
  ): Promise<void> {
    const companyId = input.companyId;

    await this.audit.write(tx, {
      companyId,
      actorUserId: null,
      action: AI_INTENT_CLASSIFIED,
      targetType: 'CONVERSATION',
      targetId: input.conversationId,
      before: null,
      after: {
        intent: ctx.intent,
        confidence: ctx.confidence,
        rationale: ctx.rationale,
        messageId: input.messageId,
        leadId: input.leadId,
        pipeline: AI_ASSIST_PIPELINE,
      },
    });

    if (ctx.kbHit && ctx.kb.bestMatch) {
      await this.audit.write(tx, {
        companyId,
        actorUserId: null,
        action: AI_KB_MATCH_FOUND,
        targetType: 'KNOWLEDGE_BASE',
        targetId: ctx.kb.bestMatch.id,
        before: null,
        after: {
          intent: ctx.intent,
          conversationId: input.conversationId,
          entryId: ctx.kb.bestMatch.id,
          kind: ctx.kb.bestMatch.kind,
          title: ctx.kb.bestMatch.title,
          confidence: ctx.kb.confidence,
          source: ctx.kb.source,
        },
      });
    } else if (this.intentService.intentRequiresKb(ctx.intent) && !ctx.kbHit) {
      await this.audit.write(tx, {
        companyId,
        actorUserId: null,
        action: AI_KB_MATCH_MISSED,
        targetType: 'CONVERSATION',
        targetId: input.conversationId,
        before: null,
        after: {
          intent: ctx.intent,
          messageId: input.messageId,
          confidence: ctx.kb.confidence,
        },
      });
    }

    await this.audit.write(tx, {
      companyId,
      actorUserId: null,
      action: AI_RESPONSE_GENERATED,
      targetType: 'CONVERSATION',
      targetId: input.conversationId,
      before: null,
      after: {
        intent: ctx.intent,
        requiresHuman: ctx.requiresHuman,
        escalationReason: ctx.escalationReason,
        suggestionPreview: ctx.suggestedBody.slice(0, 200),
        messageId: input.messageId,
        leadId: input.leadId,
        autoSend: false,
        pipeline: AI_ASSIST_PIPELINE,
      },
    });

    if (ctx.requiresHuman) {
      await this.audit.write(tx, {
        companyId,
        actorUserId: null,
        action: AI_ESCALATED,
        targetType: 'CONVERSATION',
        targetId: input.conversationId,
        before: null,
        after: {
          intent: ctx.intent,
          escalationReason: ctx.escalationReason,
          requiresHuman: true,
          messageId: input.messageId,
          leadId: input.leadId,
          pipeline: AI_ASSIST_PIPELINE,
        },
      });
    }
  }
}
