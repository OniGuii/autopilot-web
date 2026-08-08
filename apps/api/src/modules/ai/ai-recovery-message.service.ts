import { Injectable, Optional } from '@nestjs/common';
import { AiIntent, MessageDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AI_RECOVERY_PROMPT_VERSION,
  AI_SUGGESTION_MAX_CHARS,
} from './ai.constants';
import { KnowledgeBaseResolver } from './knowledge-base-resolver.service';
import { SalesMemoryService } from './sales-memory.service';
import type { SalesTemperature } from './sales-memory.types';

export type RecoveryMessageInput = {
  companyId: string;
  leadId: string;
  conversationId: string;
  attempt: number;
  intent: AiIntent | null;
  leadName: string | null;
};

/**
 * Builds recovery copy from conversation context + KB + last intent.
 * No single hardcoded blast string — content is composed from live KB/context.
 */
@Injectable()
export class AiRecoveryMessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kbResolver: KnowledgeBaseResolver,
    @Optional() private readonly salesMemory?: SalesMemoryService,
  ) {}

  async generate(input: RecoveryMessageInput): Promise<{
    body: string;
    intent: AiIntent;
    kbSource: string | null;
    promptVersion: string;
    score: number | null;
    temperature: SalesTemperature | null;
  }> {
    const intent = input.intent ?? AiIntent.UNKNOWN;
    const messages = await this.prisma.message.findMany({
      where: {
        companyId: input.companyId,
        conversationId: input.conversationId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { direction: true, body: true },
    });
    const lastInbound = messages.find(
      (m) => m.direction === MessageDirection.INBOUND && m.body?.trim(),
    );

    // 11E.1/11E.2 — continue sales context + expose score (no cadence change).
    let memorySummary: string | null = null;
    let score: number | null = null;
    let temperature: SalesTemperature | null = null;
    if (this.salesMemory) {
      try {
        const memory = await this.salesMemory.loadMemory(
          input.companyId,
          input.conversationId,
        );
        memorySummary = this.salesMemory.formatForPrompt(memory);
        score = memory.score;
        temperature = memory.temperature;
      } catch {
        memorySummary = null;
      }
    }

    const seed =
      memorySummary ||
      lastInbound?.body?.trim() ||
      this.intentSeedQuery(intent) ||
      'acompanhamento comercial';

    const kb = await this.kbResolver.resolve({
      companyId: input.companyId,
      intent: intent === AiIntent.UNKNOWN ? AiIntent.PRODUCT : intent,
      message: seed,
    });

    const name = input.leadName?.trim() || 'tudo bem';
    const attemptLabel =
      input.attempt <= 1 ? 'R1' : input.attempt === 2 ? 'R2' : 'R3';

    const angle = this.intentAngle(intent, attemptLabel, temperature);
    const kbBlock = kb.bestMatch
      ? `${kb.bestMatch.title}: ${kb.bestMatch.body}`
      : null;
    const contextHint = lastInbound?.body
      ? this.shorten(lastInbound.body, 160)
      : null;

    const parts = [
      `Olá${input.leadName?.trim() ? `, ${name}` : ''}!`,
      angle,
      memorySummary
        ? `Retomando do que já combinamos: ${memorySummary}.`
        : null,
      contextHint && !memorySummary
        ? `Vi que você comentou: "${contextHint}".`
        : null,
      kbBlock
        ? `Para facilitar, reforço o que temos na base:\n${kbBlock}`
        : 'Posso te ajudar a avançar com a melhor opção para o seu caso.',
      this.intentCta(intent, temperature),
    ].filter(Boolean) as string[];

    let body = parts.join('\n\n');
    if (body.length > AI_SUGGESTION_MAX_CHARS) {
      body = body.slice(0, AI_SUGGESTION_MAX_CHARS);
    }

    return {
      body,
      intent,
      kbSource: kb.source,
      promptVersion: AI_RECOVERY_PROMPT_VERSION,
      score,
      temperature,
    };
  }

  private intentSeedQuery(intent: AiIntent): string {
    switch (intent) {
      case AiIntent.PRICE:
        return 'preço valor orçamento';
      case AiIntent.PRODUCT:
        return 'produto modelo estoque';
      case AiIntent.PAYMENT:
        return 'pagamento pix parcelamento';
      case AiIntent.DELIVERY:
        return 'entrega frete prazo';
      case AiIntent.HOURS:
        return 'horário funcionamento';
      case AiIntent.ADDRESS:
        return 'endereço localização';
      default:
        return 'proposta comercial';
    }
  }

  private intentAngle(
    intent: AiIntent,
    attempt: string,
    temperature: SalesTemperature | null,
  ): string {
    // 11E.2 — tone by temperature only (cadence unchanged).
    if (temperature === 'HOT') {
      return `Retomando (${attempt}) para avançarmos no que você já demonstrou interesse.`;
    }
    if (temperature === 'COLD') {
      return `Passando só para manter o contato (${attempt}), sem pressão.`;
    }
    switch (intent) {
      case AiIntent.PRICE:
        return `Passando para retomar a conversa sobre valores (${attempt}).`;
      case AiIntent.PRODUCT:
        return `Voltei para reforçar o interesse no produto que você perguntou (${attempt}).`;
      case AiIntent.PAYMENT:
        return `Queria facilitar o fechamento nas condições de pagamento (${attempt}).`;
      case AiIntent.DELIVERY:
        return `Retomando sobre entrega/prazos que você pediu (${attempt}).`;
      case AiIntent.HOURS:
        return `Retomando sobre nosso horário de atendimento (${attempt}).`;
      case AiIntent.ADDRESS:
        return `Retomando sobre localização/como chegar (${attempt}).`;
      default:
        return `Retomando nosso atendimento (${attempt}) para ver como posso ajudar.`;
    }
  }

  private intentCta(
    intent: AiIntent,
    temperature: SalesTemperature | null,
  ): string {
    if (temperature === 'HOT') {
      return 'Se fizer sentido, me diga como prefere seguir para fecharmos.';
    }
    if (temperature === 'COLD') {
      return 'Se ainda tiver interesse, é só responder quando puder.';
    }
    switch (intent) {
      case AiIntent.PRICE:
        return 'Se quiser, monto a melhor opção de preço para você agora.';
      case AiIntent.PRODUCT:
        return 'Me diga se ainda faz sentido e eu detalho disponibilidade.';
      case AiIntent.PAYMENT:
        return 'Posso confirmar a forma de pagamento que for melhor para você.';
      case AiIntent.DELIVERY:
        return 'Quer que eu confirme o prazo/retirada para sua região?';
      default:
        return 'Se ainda fizer sentido, é só responder esta mensagem.';
    }
  }

  private shorten(text: string, max: number): string {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  }
}
