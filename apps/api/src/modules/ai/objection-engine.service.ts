import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AiIntent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { AuditService } from '../audit/audit.service';
import {
  AI_SUGGESTION_MAX_CHARS,
  OBJECTION_AUTO_TYPES,
  OBJECTION_DETECTED,
  OBJECTION_ESCALATED,
  OBJECTION_HISTORY_MAX,
  OBJECTION_HOT_STALL_THRESHOLD,
  OBJECTION_HANDLED,
  OBJECTION_PIPELINE,
  OBJECTION_PROMPT_VERSION,
  OBJECTION_REPEAT_THRESHOLD,
  OBJECTION_TYPES,
  SALES_MEMORY_KEY,
} from './ai.constants';
import { KnowledgeBaseResolver } from './knowledge-base-resolver.service';
import { ObjectionDetectionService } from './objection-detection.service';
import { SalesMemoryService } from './sales-memory.service';
import type {
  ObjectionHistoryEntry,
  SalesMemory,
  SalesObjectionCode,
  SalesTemperature,
} from './sales-memory.types';

export type ObjectionHandleInput = {
  companyId: string;
  conversationId: string;
  leadId: string;
  messageId: string;
  messageBody: string;
  intent?: AiIntent | null;
  actorUserId?: string | null;
};

export type ObjectionHandleResult = {
  detected: boolean;
  type: SalesObjectionCode | null;
  matchedPhrase: string | null;
  body: string | null;
  canAuto: boolean;
  requiresHuman: boolean;
  requiresHumanReason: string | null;
  temperature: SalesTemperature | null;
  historyCount: number;
  sameTypeCount: number;
};

type Actor = { cid: string; sub: string };

const AUTO_SET = new Set<string>(OBJECTION_AUTO_TYPES);

@Injectable()
export class ObjectionEngineService {
  private readonly logger = new Logger(ObjectionEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly detector: ObjectionDetectionService,
    private readonly salesMemory: SalesMemoryService,
    private readonly kbResolver: KnowledgeBaseResolver,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  /**
   * Detect → persist memory → generate contextual reply → audit/metrics.
   * Does not send WhatsApp; pipeline decides ASSIST vs AUTO.
   */
  async handle(input: ObjectionHandleInput): Promise<ObjectionHandleResult> {
    const detection = this.detector.detect(input.messageBody);
    if (!detection.detected || !detection.type) {
      return {
        detected: false,
        type: null,
        matchedPhrase: null,
        body: null,
        canAuto: false,
        requiresHuman: false,
        requiresHumanReason: null,
        temperature: null,
        historyCount: 0,
        sameTypeCount: 0,
      };
    }

    const type = detection.type;
    const conv = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        companyId: input.companyId,
        deletedAt: null,
      },
      select: { id: true, metadata: true },
    });
    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    const before = this.salesMemory.readFromMetadata(conv.metadata);
    const at = new Date().toISOString();
    const entry: ObjectionHistoryEntry = {
      type,
      at,
      messageId: input.messageId,
    };
    const history = [...before.objectionHistory, entry].slice(
      -OBJECTION_HISTORY_MAX,
    );
    const sameTypeCount = history.filter((h) => h.type === type).length;
    const historyCount = history.length;

    const memory: SalesMemory = {
      ...before,
      lastObjection: type,
      objectionHistory: history,
      version: before.version === 0 ? 1 : before.version + 1,
      updatedAt: at,
      sourceMessageIds: input.messageId
        ? [
            ...before.sourceMessageIds.filter((id) => id !== input.messageId),
            input.messageId,
          ].slice(-20)
        : before.sourceMessageIds,
    };

    const escalation = this.evaluateEscalation({
      type,
      temperature: memory.temperature,
      history,
      sameTypeCount,
      purchaseIntentLevel: memory.purchaseIntentLevel,
    });

    const kbIntent = this.kbIntentForObjection(type, input.intent);
    const kb = await this.kbResolver.resolve({
      companyId: input.companyId,
      intent: kbIntent,
      message: input.messageBody,
    });

    const body = this.buildReply({
      type,
      memory,
      temperature: memory.temperature,
      intent: input.intent ?? null,
      kbTitle: kb.bestMatch?.title,
      kbBody: kb.bestMatch?.body,
      requiresHuman: escalation.requiresHuman,
    });

    const canAuto =
      !escalation.requiresHuman &&
      AUTO_SET.has(type) &&
      (memory.temperature === 'HOT' || memory.temperature === 'WARM');

    const nextMeta = {
      ...(typeof conv.metadata === 'object' &&
      conv.metadata &&
      !Array.isArray(conv.metadata)
        ? (conv.metadata as Record<string, unknown>)
        : {}),
      [SALES_MEMORY_KEY]: memory,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: conv.id },
        data: { metadata: nextMeta },
      });

      await this.audit.write(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId ?? null,
        action: OBJECTION_DETECTED,
        targetType: 'CONVERSATION',
        targetId: conv.id,
        before: {
          lastObjection: before.lastObjection,
          historyCount: before.objectionHistory.length,
        },
        after: {
          type,
          matchedPhrase: detection.matchedPhrase,
          leadId: input.leadId,
          messageId: input.messageId,
          temperature: memory.temperature,
          historyCount,
          sameTypeCount,
          pipeline: OBJECTION_PIPELINE,
        },
      });

      if (escalation.requiresHuman) {
        await this.audit.write(tx, {
          companyId: input.companyId,
          actorUserId: input.actorUserId ?? null,
          action: OBJECTION_ESCALATED,
          targetType: 'CONVERSATION',
          targetId: conv.id,
          before: null,
          after: {
            type,
            requiresHumanReason: escalation.reason,
            leadId: input.leadId,
            temperature: memory.temperature,
            historyCount,
            sameTypeCount,
            pipeline: OBJECTION_PIPELINE,
          },
        });
      } else {
        await this.audit.write(tx, {
          companyId: input.companyId,
          actorUserId: input.actorUserId ?? null,
          action: OBJECTION_HANDLED,
          targetType: 'CONVERSATION',
          targetId: conv.id,
          before: null,
          after: {
            type,
            canAuto,
            leadId: input.leadId,
            temperature: memory.temperature,
            promptVersion: OBJECTION_PROMPT_VERSION,
            kbHit: Boolean(kb.bestMatch),
            pipeline: OBJECTION_PIPELINE,
          },
        });
      }
    });

    this.prom?.recordObjectionDetected(type);
    if (escalation.requiresHuman) {
      this.prom?.recordObjectionEscalated(type);
    } else {
      this.prom?.recordObjectionHandled(type);
    }

    this.logger.debug(
      `objection ${type} company=${input.companyId} conversation=${conv.id} escalate=${escalation.requiresHuman} canAuto=${canAuto}`,
    );

    return {
      detected: true,
      type,
      matchedPhrase: detection.matchedPhrase,
      body,
      canAuto,
      requiresHuman: escalation.requiresHuman,
      requiresHumanReason: escalation.reason,
      temperature: memory.temperature,
      historyCount,
      sameTypeCount,
    };
  }

  evaluateEscalation(input: {
    type: SalesObjectionCode;
    temperature: SalesTemperature;
    history: ObjectionHistoryEntry[];
    sameTypeCount: number;
    purchaseIntentLevel: SalesMemory['purchaseIntentLevel'];
  }): { requiresHuman: boolean; reason: string | null } {
    if (input.type === 'AUTHORITY') {
      return { requiresHuman: true, reason: 'OBJECTION_AUTHORITY' };
    }
    if (input.type === 'NEED') {
      return { requiresHuman: true, reason: 'OBJECTION_NEED' };
    }
    if (input.sameTypeCount >= OBJECTION_REPEAT_THRESHOLD) {
      return { requiresHuman: true, reason: 'OBJECTION_REPEATED' };
    }
    if (
      input.temperature === 'HOT' &&
      input.history.length >= OBJECTION_HOT_STALL_THRESHOLD &&
      (input.purchaseIntentLevel === 'NONE' ||
        input.purchaseIntentLevel === 'LOW')
    ) {
      return { requiresHuman: true, reason: 'HOT_LEAD_NO_ADVANCE' };
    }
    return { requiresHuman: false, reason: null };
  }

  /** True when AUTO may send for this objection (narrow allowlist). */
  isAutoAllowed(
    type: SalesObjectionCode | null | undefined,
    temperature: SalesTemperature | null | undefined,
  ): boolean {
    if (!type || !temperature) return false;
    if (!AUTO_SET.has(type)) return false;
    return temperature === 'HOT' || temperature === 'WARM';
  }

  buildReply(input: {
    type: SalesObjectionCode;
    memory: SalesMemory;
    temperature: SalesTemperature;
    intent: AiIntent | null;
    kbTitle?: string;
    kbBody?: string;
    requiresHuman: boolean;
  }): string {
    const empathy = this.empathyLine(input.type);
    const strategy = this.strategyLines(input);
    const kbFact =
      input.kbTitle && input.kbBody
        ? `Sobre isso: ${input.kbTitle} — ${this.clip(input.kbBody, 400)}`
        : null;
    const cta = this.ctaLine(input.type, input.requiresHuman);
    const tempHint =
      input.temperature === 'HOT'
        ? 'Posso te ajudar a fechar o próximo passo com tranquilidade.'
        : input.temperature === 'WARM'
          ? 'Se fizer sentido, seguimos no seu ritmo.'
          : null;

    const parts = [empathy, ...strategy, kbFact, tempHint, cta].filter(
      (p): p is string => Boolean(p && p.trim()),
    );

    return this.clip(parts.join('\n\n'), AI_SUGGESTION_MAX_CHARS);
  }

  async getDashboard(actor: Actor) {
    const companyId = actor.cid;
    const conversations = await this.prisma.conversation.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, metadata: true },
      take: 2000,
    });

    const counts: Record<SalesObjectionCode, number> = {
      PRICE: 0,
      TIME: 0,
      TRUST: 0,
      COMPARISON: 0,
      AUTHORITY: 0,
      NEED: 0,
      UNKNOWN: 0,
    };

    let conversationsWithObjection = 0;
    for (const c of conversations) {
      const mem = this.salesMemory.readFromMetadata(c.metadata);
      if (mem.objectionHistory.length === 0 && !mem.lastObjection) continue;
      conversationsWithObjection += 1;
      if (mem.objectionHistory.length > 0) {
        for (const h of mem.objectionHistory) {
          if (h.type in counts) counts[h.type] += 1;
        }
      } else if (mem.lastObjection && mem.lastObjection in counts) {
        counts[mem.lastObjection] += 1;
      }
    }

    const topObjections = (OBJECTION_TYPES as readonly SalesObjectionCode[])
      .filter((t) => t !== 'UNKNOWN')
      .map((type) => ({ type, count: counts[type] }))
      .sort((a, b) => b.count - a.count);

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      topObjections,
      totals: counts,
      conversationsWithObjection,
      autoAllowedTypes: [...OBJECTION_AUTO_TYPES],
      pipeline: OBJECTION_PIPELINE,
    };
  }

  private kbIntentForObjection(
    type: SalesObjectionCode,
    intent?: AiIntent | null,
  ): AiIntent {
    if (type === 'PRICE') return AiIntent.PRICE;
    if (type === 'COMPARISON') return AiIntent.PRODUCT;
    if (type === 'TRUST') return AiIntent.PRODUCT;
    if (type === 'TIME') return intent ?? AiIntent.PRODUCT;
    if (intent && intent !== AiIntent.UNKNOWN && intent !== AiIntent.HUMAN) {
      return intent;
    }
    return AiIntent.PRODUCT;
  }

  private empathyLine(type: SalesObjectionCode): string {
    switch (type) {
      case 'PRICE':
        return 'Entendo a preocupação com o investimento.';
      case 'TIME':
        return 'Sem problema — timing é importante.';
      case 'TRUST':
        return 'Faz sentido querer segurança antes de seguir.';
      case 'COMPARISON':
        return 'Comparar opções é uma boa prática.';
      case 'AUTHORITY':
        return 'Perfeito alinhar com quem decide junto.';
      case 'NEED':
        return 'Obrigado pela sinceridade — quero entender melhor o contexto.';
      default:
        return 'Obrigado por compartilhar isso.';
    }
  }

  private strategyLines(input: {
    type: SalesObjectionCode;
    memory: SalesMemory;
  }): string[] {
    const budget = input.memory.budget;
    const product = input.memory.productInterest[0];
    switch (input.type) {
      case 'PRICE':
        return [
          'O valor costuma refletir o benefício e o suporte no dia a dia.',
          budget
            ? `Com o orçamento que você mencionou (${budget}), posso ajudar a enxergar a alternativa que melhor encaixa.`
            : 'Se quiser, olhamos juntos uma alternativa alinhada ao seu orçamento.',
        ];
      case 'TIME':
        return [
          'Posso reservar um próximo contato no momento em que for melhor para você.',
          'Enquanto isso, a disponibilidade pode mudar — me diga um horário bom.',
        ];
      case 'TRUST':
        return [
          'Trabalhamos com clareza de processo, garantia conforme a oferta e suporte quando precisar.',
          'Se preferir, um especialista humano também pode te orientar.',
        ];
      case 'COMPARISON':
        return [
          product
            ? `No ${product}, o diferencial costuma estar no atendimento e no que está incluso — sem inventar vantagem fora da nossa base.`
            : 'Nosso diferencial está no atendimento e no que está incluso — sem inventar vantagem fora da nossa base.',
          'Qual critério é decisivo para você na comparação?',
        ];
      case 'AUTHORITY':
        return [
          'Posso preparar um resumo objetivo para você levar na conversa com o decisor.',
        ];
      case 'NEED':
        return [
          'Antes de qualquer proposta: qual problema você gostaria de resolver hoje?',
        ];
      default:
        return ['Pode me contar um pouco mais do que está te travando?'];
    }
  }

  private ctaLine(type: SalesObjectionCode, requiresHuman: boolean): string {
    if (requiresHuman) {
      return 'Vou sinalizar para um atendente humano continuar com você com mais cuidado.';
    }
    switch (type) {
      case 'PRICE':
        return 'Quer que eu destaque o benefício principal e uma alternativa mais enxuta?';
      case 'TIME':
        return 'Prefere que eu te chame amanhã ou no começo da próxima semana?';
      case 'TRUST':
        return 'Quer que eu explique garantia/suporte com base nas informações oficiais?';
      case 'COMPARISON':
        return 'Me conta o que a outra opção oferece que está pesando mais.';
      default:
        return 'Como prefere seguir?';
    }
  }

  private clip(s: string, max: number): string {
    const t = s.replace(/\s+\n/g, '\n').trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  }
}
