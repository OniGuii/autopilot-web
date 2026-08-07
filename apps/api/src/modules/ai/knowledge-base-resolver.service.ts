import { Injectable } from '@nestjs/common';
import { AiIntent, KnowledgeBaseKind, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type KnowledgeBaseMatch = {
  id: string;
  kind: KnowledgeBaseKind;
  title: string;
  body: string;
  tags: string[];
};

export type KnowledgeBaseResolveResult = {
  bestMatch: KnowledgeBaseMatch | null;
  confidence: number;
  source: string | null;
};

const INTENT_KINDS: Partial<Record<AiIntent, KnowledgeBaseKind[]>> = {
  [AiIntent.PRICE]: [
    KnowledgeBaseKind.PRICE,
    KnowledgeBaseKind.PRODUCT,
    KnowledgeBaseKind.FAQ,
  ],
  [AiIntent.PRODUCT]: [
    KnowledgeBaseKind.PRODUCT,
    KnowledgeBaseKind.PRICE,
    KnowledgeBaseKind.FAQ,
  ],
  [AiIntent.PAYMENT]: [KnowledgeBaseKind.PAYMENT, KnowledgeBaseKind.FAQ],
  [AiIntent.DELIVERY]: [
    KnowledgeBaseKind.DELIVERY,
    KnowledgeBaseKind.ADDRESS,
    KnowledgeBaseKind.FAQ,
  ],
  [AiIntent.COMPLAINT]: [KnowledgeBaseKind.FAQ],
  [AiIntent.UNKNOWN]: [KnowledgeBaseKind.FAQ],
  [AiIntent.HUMAN]: [],
};

const STOPWORDS = new Set([
  'a',
  'o',
  'os',
  'as',
  'um',
  'uma',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'é',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'que',
  'qual',
  'quais',
  'por',
  'para',
  'com',
  'se',
  'me',
  'meu',
  'minha',
  'vocês',
  'voces',
  'voce',
  'você',
  'tem',
  'há',
  'ha',
  'the',
  'oi',
  'olá',
  'ola',
]);

const MIN_CONFIDENCE = 0.22;

@Injectable()
export class KnowledgeBaseResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: {
    companyId: string;
    intent: AiIntent;
    message: string;
  }): Promise<KnowledgeBaseResolveResult> {
    const kinds = INTENT_KINDS[input.intent] ?? [];
    if (kinds.length === 0) {
      return { bestMatch: null, confidence: 0, source: null };
    }

    const tokens = this.tokenize(input.message);
    if (tokens.length === 0) {
      return { bestMatch: null, confidence: 0, source: null };
    }

    const where: Prisma.KnowledgeBaseEntryWhereInput = {
      companyId: input.companyId,
      deletedAt: null,
      active: true,
      kind: { in: kinds },
    };

    const entries = await this.prisma.knowledgeBaseEntry.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        tags: true,
      },
    });

    let best: KnowledgeBaseMatch | null = null;
    let bestScore = 0;

    for (const entry of entries) {
      const haystack = this.tokenize(
        `${entry.title} ${entry.body} ${entry.tags.join(' ')}`,
      );
      if (haystack.length === 0) continue;
      const hayset = new Set(haystack);
      let hits = 0;
      for (const t of tokens) {
        if (hayset.has(t)) hits += 1;
      }
      // Prefer title/tag hits lightly via raw substring boost.
      const titleBlob = `${entry.title} ${entry.tags.join(' ')}`.toLowerCase();
      let titleBoost = 0;
      for (const t of tokens) {
        if (titleBlob.includes(t)) titleBoost += 0.08;
      }
      const score = Math.min(1, hits / tokens.length + titleBoost);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    if (!best || bestScore < MIN_CONFIDENCE) {
      return { bestMatch: null, confidence: bestScore, source: null };
    }

    return {
      bestMatch: best,
      confidence: Number(bestScore.toFixed(3)),
      source: `kb:${best.kind}:${best.id}`,
    };
  }

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  }
}
