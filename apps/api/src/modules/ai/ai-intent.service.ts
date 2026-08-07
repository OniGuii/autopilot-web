import { Injectable, Optional } from '@nestjs/common';
import { AiIntent, KnowledgeBaseKind, type Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import {
  AI_ESCALATED,
  AI_INTENT_CLASSIFIED,
  AI_KB_MATCHED,
} from './ai.constants';
import { KnowledgeBaseService } from './knowledge-base.service';

export type IntentClassificationInput = {
  companyId: string;
  message: string;
  recentContext?: string[];
  actorUserId?: string;
  meta?: { ip?: string; userAgent?: string };
  /** When false, skip audit writes (pure classify). Default true. */
  audit?: boolean;
};

export type IntentClassificationResult = {
  intent: AiIntent;
  confidence: number;
  escalated: boolean;
  escalationReason: string | null;
  kbMatched: boolean;
  matchedKinds: KnowledgeBaseKind[];
  rationale: string;
};

type RuleHit = {
  intent: AiIntent;
  confidence: number;
  rationale: string;
};

const INTENT_TO_KB: Partial<Record<AiIntent, KnowledgeBaseKind[]>> = {
  [AiIntent.PRICE]: [KnowledgeBaseKind.PRICE, KnowledgeBaseKind.PRODUCT],
  [AiIntent.PRODUCT]: [KnowledgeBaseKind.PRODUCT, KnowledgeBaseKind.PRICE],
  [AiIntent.PAYMENT]: [KnowledgeBaseKind.PAYMENT],
  [AiIntent.DELIVERY]: [KnowledgeBaseKind.DELIVERY, KnowledgeBaseKind.ADDRESS],
};

@Injectable()
export class AiIntentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly knowledgeBase: KnowledgeBaseService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  async classify(
    input: IntentClassificationInput,
  ): Promise<IntentClassificationResult> {
    const message = input.message?.trim() ?? '';
    const context = (input.recentContext ?? [])
      .map((c) => c.trim())
      .filter(Boolean);
    const blob = [...context, message].join('\n').toLowerCase();

    const hit = this.classifyHeuristic(blob, message);
    const activeKinds = await this.knowledgeBase.listActiveKinds(
      input.companyId,
    );
    const requiredKinds = INTENT_TO_KB[hit.intent] ?? [];
    const matchedKinds = requiredKinds.filter((k) => activeKinds.has(k));
    const kbMatched =
      requiredKinds.length === 0 ? false : matchedKinds.length > 0;

    const { escalated, escalationReason } = this.evaluateEscalation(
      hit.intent,
      kbMatched,
      requiredKinds.length > 0,
    );

    const result: IntentClassificationResult = {
      intent: hit.intent,
      confidence: hit.confidence,
      escalated,
      escalationReason,
      kbMatched,
      matchedKinds,
      rationale: hit.rationale,
    };

    this.prom?.recordAiClassification();
    if (kbMatched) this.prom?.recordAiKbMatch();
    if (escalated) this.prom?.recordAiEscalation();

    if (input.audit !== false) {
      await this.persistAudits(input, result);
    }

    return result;
  }

  evaluateEscalation(
    intent: AiIntent,
    kbMatched: boolean,
    kbRequired: boolean,
  ): { escalated: boolean; escalationReason: string | null } {
    if (intent === AiIntent.COMPLAINT) {
      return { escalated: true, escalationReason: 'COMPLAINT' };
    }
    if (intent === AiIntent.HUMAN) {
      return { escalated: true, escalationReason: 'HUMAN' };
    }
    if (intent === AiIntent.UNKNOWN) {
      return { escalated: true, escalationReason: 'UNKNOWN' };
    }
    if (intent === AiIntent.PRICE && kbRequired && !kbMatched) {
      return { escalated: true, escalationReason: 'PRICE_WITHOUT_KB' };
    }
    return { escalated: false, escalationReason: null };
  }

  /** Deterministic PT-BR keyword classifier (11A — no OpenAI dependency). */
  classifyHeuristic(blob: string, message: string): RuleHit {
    if (!message.trim()) {
      return {
        intent: AiIntent.UNKNOWN,
        confidence: 0.2,
        rationale: 'empty_message',
      };
    }

    const rules: Array<{ intent: AiIntent; patterns: RegExp[]; conf: number }> =
      [
        {
          intent: AiIntent.HUMAN,
          conf: 0.95,
          patterns: [
            /\b(atendente|humano|pessoa|gerente|falar com (algu[eé]m|um|uma))\b/i,
            /\b(quero (falar|um) (com )?(atendente|humano|pessoa))\b/i,
            /\b(me passa (para|pro) (um )?atendente)\b/i,
          ],
        },
        {
          intent: AiIntent.COMPLAINT,
          conf: 0.92,
          patterns: [
            /\b(reclama(r|ção|cao)|p[eé]ssimo|horr[ií]vel|absurdo|procon|processo)\b/i,
            /\b(estou (muito )?irritad[oa]|não funciona|nao funciona|golpe)\b/i,
            /\b(quero meu dinheiro|cancel(a|ar) (agora|tudo))\b/i,
          ],
        },
        {
          intent: AiIntent.PRICE,
          conf: 0.88,
          patterns: [
            /\b(pre[cç]o|valor|or[cç]amento|quanto custa|promoc[aã]o|desconto)\b/i,
            /\b(r\$\s*\d|barato|caro)\b/i,
          ],
        },
        {
          intent: AiIntent.PAYMENT,
          conf: 0.88,
          patterns: [
            /\b(pix|cart[aã]o|boleto|parcel(a|as|amento)|forma de pagamento|pagamento)\b/i,
            /\b(aceita (pix|cart[aã]o)|pode parcelar)\b/i,
          ],
        },
        {
          intent: AiIntent.DELIVERY,
          conf: 0.88,
          patterns: [
            /\b(entrega|frete|prazo de entrega|retirada|buscar a[ií]|envia(m|r)?)\b/i,
            /\b(delivery|sedex|correios)\b/i,
          ],
        },
        {
          intent: AiIntent.PRODUCT,
          conf: 0.85,
          patterns: [
            /\b(produto|modelo|tem (o|a|esse|essa)|voc[eê]s t[eê]m|estoque|especifica[cç][aã]o)\b/i,
            /\b(como (é|e) o|serve para|funciona)\b/i,
          ],
        },
      ];

    for (const rule of rules) {
      if (rule.patterns.some((p) => p.test(blob))) {
        return {
          intent: rule.intent,
          confidence: rule.conf,
          rationale: `heuristic:${rule.intent}`,
        };
      }
    }

    return {
      intent: AiIntent.UNKNOWN,
      confidence: 0.4,
      rationale: 'heuristic:no_match',
    };
  }

  private async persistAudits(
    input: IntentClassificationInput,
    result: IntentClassificationResult,
  ): Promise<void> {
    const companyId = input.companyId;
    await this.prisma.$transaction(async (tx) => {
      const client = tx as Prisma.TransactionClient;
      await this.audit.write(client, {
        companyId,
        actorUserId: input.actorUserId ?? null,
        action: AI_INTENT_CLASSIFIED,
        targetType: 'AI_INTENT',
        targetId: companyId,
        before: null,
        after: {
          intent: result.intent,
          confidence: result.confidence,
          rationale: result.rationale,
          kbMatched: result.kbMatched,
          matchedKinds: result.matchedKinds,
        },
        ip: input.meta?.ip,
        userAgent: input.meta?.userAgent,
      });

      if (result.kbMatched) {
        await this.audit.write(client, {
          companyId,
          actorUserId: input.actorUserId ?? null,
          action: AI_KB_MATCHED,
          targetType: 'KNOWLEDGE_BASE',
          targetId: companyId,
          before: null,
          after: {
            intent: result.intent,
            matchedKinds: result.matchedKinds,
          },
          ip: input.meta?.ip,
          userAgent: input.meta?.userAgent,
        });
      }

      if (result.escalated) {
        await this.audit.write(client, {
          companyId,
          actorUserId: input.actorUserId ?? null,
          action: AI_ESCALATED,
          targetType: 'AI_ESCALATION',
          targetId: companyId,
          before: null,
          after: {
            intent: result.intent,
            escalationReason: result.escalationReason,
            escalated: true,
          },
          ip: input.meta?.ip,
          userAgent: input.meta?.userAgent,
        });
      }
    });
  }
}
