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
import { newCorrelationId } from '../whatsapp/correlation';
import { WhatsappSendService } from '../whatsapp/outbound/whatsapp-send.service';
import {
  AI_AGENT_MESSAGE_SOURCE,
  AI_ASSIST_MODEL,
  AI_ASSIST_PIPELINE,
  AI_ASSIST_PROMPT_VERSION,
  AI_AUTO_PIPELINE,
  AI_AUTO_PROMPT_VERSION,
  AI_AUTO_SENT,
  AI_AUTO_SKIPPED,
  AI_ESCALATED,
  AI_FOLLOWUP_TYPE,
  AI_INTENT_CLASSIFIED,
  AI_KB_MATCH_FOUND,
  AI_KB_MATCH_MISSED,
  AI_METADATA_SOURCE,
  AI_RESPONSE_GENERATED,
  AI_SUGGESTION_MAX_CHARS,
} from './ai.constants';
import { AiAutoGuardrailsService } from './ai-auto-guardrails.service';
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
  messageId?: string;
  intent?: AiIntent;
  requiresHuman?: boolean;
  whatsappSent: boolean;
  mode?: AiAgentMode;
  correlationId?: string;
};

type PipelineMetadata = {
  source: typeof AI_METADATA_SOURCE;
  pipeline: string;
  model: typeof AI_ASSIST_MODEL;
  promptVersion: string;
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
  autoSend: boolean;
  correlationId?: string;
  outboundMessageId?: string;
  skipReason?: string;
};

@Injectable()
export class AiAssistPipelineService {
  private readonly logger = new Logger(AiAssistPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly intentService: AiIntentService,
    private readonly kbResolver: KnowledgeBaseResolver,
    private readonly guardrails: AiAutoGuardrailsService,
    @Optional() private readonly whatsappSend?: WhatsappSendService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  /**
   * Pós-inbound (11B/11C):
   * - OFF → stop
   * - ASSIST → FollowUp SUGGESTED
   * - AUTO → send via WhatsappSendService when safe; else degrade ASSIST / escalate
   */
  async handleInbound(
    input: AssistInboundInput,
  ): Promise<AssistPipelineResult> {
    const settings = await this.resolveSettings(input.companyId);
    if (settings.mode === AiAgentMode.OFF) {
      return {
        skipped: true,
        reason: 'AGENT_MODE_OFF',
        whatsappSent: false,
        mode: AiAgentMode.OFF,
      };
    }

    const already = await this.prisma.followUp.findFirst({
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
    if (already) {
      return {
        skipped: true,
        reason: 'ALREADY_PROCESSED',
        followUpId: already.id,
        whatsappSent: false,
        mode: settings.mode,
      };
    }

    // Dedup AUTO outbound already created for this inbound.
    const existingOutbound = await this.prisma.message.findFirst({
      where: {
        companyId: input.companyId,
        deletedAt: null,
        direction: 'OUTBOUND',
        metadata: {
          path: ['inboundMessageId'],
          equals: input.messageId,
        },
      },
      select: { id: true },
    });
    if (existingOutbound) {
      return {
        skipped: true,
        reason: 'ALREADY_PROCESSED_OUTBOUND',
        messageId: existingOutbound.id,
        whatsappSent: true,
        mode: settings.mode,
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
    let requiresHuman = escalation.escalated;
    let escalationReason = escalation.escalationReason;

    this.prom?.recordAiIntent(classification.intent);
    if (kbHit) {
      this.prom?.recordAiKbHit();
    } else if (kbRequired) {
      this.prom?.recordAiKbMiss();
    }

    const suggestedBody = this.buildSuggestedBody({
      intent: classification.intent,
      requiresHuman,
      escalationReason,
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
        agentPaused: true,
        lead: { select: { ownerId: true } },
      },
    });
    if (!conversation) {
      return {
        skipped: true,
        reason: 'CONVERSATION_NOT_FOUND',
        whatsappSent: false,
        mode: settings.mode,
      };
    }

    const assignedUserId =
      conversation.assignedUserId ?? conversation.lead.ownerId ?? null;

    const neverAuto =
      classification.intent === AiIntent.COMPLAINT ||
      classification.intent === AiIntent.HUMAN ||
      classification.intent === AiIntent.UNKNOWN ||
      !this.intentService.isAutoSafeIntent(classification.intent);

    const wantAuto =
      settings.mode === AiAgentMode.AUTO &&
      !neverAuto &&
      kbHit &&
      !requiresHuman;

    if (wantAuto && this.whatsappSend) {
      const gate = await this.guardrails.evaluate({
        companyId: input.companyId,
        conversationId: input.conversationId,
        leadId: input.leadId,
        confidence: classification.confidence,
        maxAutoRepliesPerLeadDay: settings.maxAutoRepliesPerLeadDay,
        agentPaused: conversation.agentPaused,
      });

      if (gate.allowed) {
        return this.executeAutoSend(input, {
          classification,
          kb,
          kbHit,
          requiresHuman: false,
          escalationReason: null,
          suggestedBody,
          assignedUserId,
          mode: settings.mode,
        });
      }

      this.prom?.recordAiAutoSkipped();
      await this.auditStandalone(input, AI_AUTO_SKIPPED, {
        intent: classification.intent,
        reason: gate.reason,
        pipeline: AI_AUTO_PIPELINE,
      });
      // Degrade to ASSIST suggestion path.
      this.logger.debug(
        `AUTO skipped company=${input.companyId} reason=${gate.reason}`,
      );
    } else if (settings.mode === AiAgentMode.AUTO && neverAuto) {
      requiresHuman = true;
      escalationReason = escalationReason ?? classification.intent;
    } else if (settings.mode === AiAgentMode.AUTO && !kbHit && kbRequired) {
      requiresHuman = true;
      escalationReason =
        escalationReason ?? `${classification.intent}_WITHOUT_KB`;
    }

    if (requiresHuman) this.prom?.recordAiResponseEscalated();

    const pauseAgent =
      classification.intent === AiIntent.COMPLAINT ||
      classification.intent === AiIntent.HUMAN;

    const metadata: PipelineMetadata = {
      source: AI_METADATA_SOURCE,
      pipeline:
        settings.mode === AiAgentMode.AUTO
          ? AI_AUTO_PIPELINE
          : AI_ASSIST_PIPELINE,
      model: AI_ASSIST_MODEL,
      promptVersion: AI_ASSIST_PROMPT_VERSION,
      intent: classification.intent,
      confidence: classification.confidence,
      requiresHuman,
      escalationReason,
      kb: this.kbMeta(kbHit, kb),
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
        escalationReason,
        kbHit,
        kb,
        suggestedBody,
        autoSend: false,
        pipeline: metadata.pipeline,
      });

      await this.persistMessageIntent(tx, input, {
        intent: classification.intent,
        confidence: classification.confidence,
        requiresHuman,
        escalationReason,
        pipeline: metadata.pipeline,
      });

      if (pauseAgent) {
        await tx.conversation.update({
          where: { id: input.conversationId },
          data: { agentPaused: true },
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
      mode: settings.mode,
    };
  }

  private async executeAutoSend(
    input: AssistInboundInput,
    ctx: {
      classification: {
        intent: AiIntent;
        confidence: number;
        rationale: string;
      };
      kb: Awaited<ReturnType<KnowledgeBaseResolver['resolve']>>;
      kbHit: boolean;
      requiresHuman: boolean;
      escalationReason: string | null;
      suggestedBody: string;
      assignedUserId: string | null;
      mode: AiAgentMode;
    },
  ): Promise<AssistPipelineResult> {
    const correlationId = newCorrelationId();
    const actorSub = ctx.assignedUserId ?? input.companyId;

    try {
      const sent = await this.whatsappSend!.send(
        { cid: input.companyId, sub: actorSub } as never,
        {
          leadId: input.leadId,
          conversationId: input.conversationId,
          body: ctx.suggestedBody,
          metadata: {
            source: AI_AGENT_MESSAGE_SOURCE,
            correlationId,
            inboundMessageId: input.messageId,
            intent: ctx.classification.intent,
            pipeline: AI_AUTO_PIPELINE,
            autoSend: true,
          },
        },
      );

      const metadata: PipelineMetadata = {
        source: AI_METADATA_SOURCE,
        pipeline: AI_AUTO_PIPELINE,
        model: AI_ASSIST_MODEL,
        promptVersion: AI_AUTO_PROMPT_VERSION,
        intent: ctx.classification.intent,
        confidence: ctx.classification.confidence,
        requiresHuman: false,
        escalationReason: null,
        kb: this.kbMeta(ctx.kbHit, ctx.kb),
        inboundMessageId: input.messageId,
        generatedAt: new Date().toISOString(),
        attemptCount: 0,
        autoSend: true,
        correlationId: sent.correlationId,
        outboundMessageId: sent.messageId,
      };

      const followUp = await this.prisma.$transaction(async (tx) => {
        await this.writePipelineAudits(tx, input, {
          intent: ctx.classification.intent,
          confidence: ctx.classification.confidence,
          rationale: ctx.classification.rationale,
          requiresHuman: false,
          escalationReason: null,
          kbHit: ctx.kbHit,
          kb: ctx.kb,
          suggestedBody: ctx.suggestedBody,
          autoSend: true,
          pipeline: AI_AUTO_PIPELINE,
          correlationId: sent.correlationId,
          outboundMessageId: sent.messageId,
        });

        await this.persistMessageIntent(tx, input, {
          intent: ctx.classification.intent,
          confidence: ctx.classification.confidence,
          requiresHuman: false,
          escalationReason: null,
          pipeline: AI_AUTO_PIPELINE,
        });

        await this.audit.write(tx, {
          companyId: input.companyId,
          actorUserId: null,
          action: AI_AUTO_SENT,
          targetType: 'MESSAGE',
          targetId: sent.messageId,
          before: null,
          after: {
            conversationId: input.conversationId,
            leadId: input.leadId,
            inboundMessageId: input.messageId,
            intent: ctx.classification.intent,
            correlationId: sent.correlationId,
            autoSend: true,
            pipeline: AI_AUTO_PIPELINE,
          },
        });

        return tx.followUp.create({
          data: {
            companyId: input.companyId,
            conversationId: input.conversationId,
            leadId: input.leadId,
            assignedUserId: ctx.assignedUserId,
            type: AI_FOLLOWUP_TYPE,
            channel: Channel.WHATSAPP,
            status: FollowUpStatus.EXECUTED,
            suggestedBody: ctx.suggestedBody,
            executedAt: new Date(),
            resultMessageId: sent.messageId,
            metadata,
          },
        });
      });

      this.prom?.recordAiResponseGenerated();
      this.prom?.recordAiAutoSent();

      return {
        skipped: false,
        followUpId: followUp.id,
        messageId: sent.messageId,
        intent: ctx.classification.intent,
        requiresHuman: false,
        whatsappSent: true,
        mode: ctx.mode,
        correlationId: sent.correlationId,
      };
    } catch (err) {
      this.logger.warn(
        `AUTO send failed company=${input.companyId} conversation=${input.conversationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.prom?.recordAiAutoSkipped();
      await this.auditStandalone(input, AI_AUTO_SKIPPED, {
        intent: ctx.classification.intent,
        reason: 'SEND_FAILED',
        error: err instanceof Error ? err.message : String(err),
        pipeline: AI_AUTO_PIPELINE,
        correlationId,
      });

      // Degrade to ASSIST suggestion.
      const metadata: PipelineMetadata = {
        source: AI_METADATA_SOURCE,
        pipeline: AI_AUTO_PIPELINE,
        model: AI_ASSIST_MODEL,
        promptVersion: AI_ASSIST_PROMPT_VERSION,
        intent: ctx.classification.intent,
        confidence: ctx.classification.confidence,
        requiresHuman: false,
        escalationReason: null,
        kb: this.kbMeta(ctx.kbHit, ctx.kb),
        inboundMessageId: input.messageId,
        generatedAt: new Date().toISOString(),
        attemptCount: 0,
        autoSend: false,
        skipReason: 'SEND_FAILED',
        correlationId,
      };

      const followUp = await this.prisma.followUp.create({
        data: {
          companyId: input.companyId,
          conversationId: input.conversationId,
          leadId: input.leadId,
          assignedUserId: ctx.assignedUserId,
          type: AI_FOLLOWUP_TYPE,
          channel: Channel.WHATSAPP,
          status: FollowUpStatus.SUGGESTED,
          suggestedBody: ctx.suggestedBody,
          metadata,
        },
      });

      this.prom?.recordAiResponseGenerated();

      return {
        skipped: false,
        followUpId: followUp.id,
        intent: ctx.classification.intent,
        requiresHuman: false,
        whatsappSent: false,
        mode: ctx.mode,
        reason: 'SEND_FAILED_DEGRADED_ASSIST',
        correlationId,
      };
    }
  }

  private async resolveSettings(companyId: string) {
    const row = await this.prisma.companyAiSettings.findFirst({
      where: { companyId, deletedAt: null },
      select: { mode: true, maxAutoRepliesPerLeadDay: true },
    });
    return {
      mode: row?.mode ?? AiAgentMode.ASSIST,
      maxAutoRepliesPerLeadDay: row?.maxAutoRepliesPerLeadDay ?? 3,
    };
  }

  private kbMeta(
    kbHit: boolean,
    kb: Awaited<ReturnType<KnowledgeBaseResolver['resolve']>>,
  ) {
    return {
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
    };
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

  private async persistMessageIntent(
    tx: Prisma.TransactionClient,
    input: AssistInboundInput,
    data: {
      intent: AiIntent;
      confidence: number;
      requiresHuman: boolean;
      escalationReason: string | null;
      pipeline: string;
    },
  ) {
    const msg = await tx.message.findFirst({
      where: {
        id: input.messageId,
        companyId: input.companyId,
        deletedAt: null,
      },
      select: { id: true, metadata: true },
    });
    if (!msg) return;
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
            intent: data.intent,
            confidence: data.confidence,
            requiresHuman: data.requiresHuman,
            escalationReason: data.escalationReason,
            classifiedAt: new Date().toISOString(),
            pipeline: data.pipeline,
          },
        },
      },
    });
  }

  private async auditStandalone(
    input: AssistInboundInput,
    action: string,
    after: Record<string, unknown>,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.write(tx, {
          companyId: input.companyId,
          actorUserId: null,
          action,
          targetType: 'CONVERSATION',
          targetId: input.conversationId,
          before: null,
          after: {
            ...after,
            messageId: input.messageId,
            leadId: input.leadId,
          },
        });
      });
    } catch (err) {
      this.logger.warn(
        `audit ${action} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
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
      autoSend: boolean;
      pipeline: string;
      correlationId?: string;
      outboundMessageId?: string;
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
        pipeline: ctx.pipeline,
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
        autoSend: ctx.autoSend,
        pipeline: ctx.pipeline,
        correlationId: ctx.correlationId ?? null,
        outboundMessageId: ctx.outboundMessageId ?? null,
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
          pipeline: ctx.pipeline,
        },
      });
    }
  }
}
