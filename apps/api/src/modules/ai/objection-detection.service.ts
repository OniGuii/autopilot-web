import { Injectable } from '@nestjs/common';
import type { SalesObjectionCode } from './sales-memory.types';

export type ObjectionDetectionResult = {
  detected: boolean;
  type: SalesObjectionCode | null;
  matchedPhrase: string | null;
};

/**
 * 11E.3 — rule-based commercial objection detection (no OpenAI).
 */
@Injectable()
export class ObjectionDetectionService {
  detect(message: string): ObjectionDetectionResult {
    const text = (message ?? '').trim();
    if (!text) {
      return { detected: false, type: null, matchedPhrase: null };
    }

    const rules: Array<{
      type: SalesObjectionCode;
      patterns: RegExp[];
    }> = [
      {
        type: 'PRICE',
        patterns: [
          /\b(caro|car[ií]ssimo|muito\s+caro)\b/i,
          /\b(sem\s+dinheiro|n[aã]o\s+tenho\s+dinheiro)\b/i,
          /\b(fora\s+do\s+or[cç]amento|acima\s+do\s+or[cç]amento)\b/i,
          /\b(n[aã]o\s+cabe\s+no\s+bolso)\b/i,
        ],
      },
      {
        type: 'TIME',
        patterns: [
          /\b(vou\s+pensar|preciso\s+pensar)\b/i,
          /\b(mais\s+tarde|depois|agora\s+n[aã]o)\b/i,
          /\b(sem\s+tempo|n[aã]o\s+tenho\s+tempo)\b/i,
          /\b(me\s+d[aá]\s+um\s+tempo)\b/i,
        ],
      },
      {
        type: 'TRUST',
        patterns: [
          /\b(n[aã]o\s+conhe[cç]o)\b/i,
          /\b([eé]\s+confi[aá]vel|confi[aá]vel\??)\b/i,
          /\b(posso\s+confiar|golpe|fraude)\b/i,
          /\b(nunca\s+ouvi\s+falar)\b/i,
        ],
      },
      {
        type: 'COMPARISON',
        patterns: [
          /\b(estou\s+comparando|comparando)\b/i,
          /\b(outra\s+loja|outro\s+lugar|concorrente)\b/i,
          /\b(mais\s+barato\s+(?:no|na|em))\b/i,
          /\b(vi\s+(?:em|no)\s+outro)\b/i,
        ],
      },
      {
        type: 'AUTHORITY',
        patterns: [
          /\b(vou\s+falar\s+com\s+(?:meu\s+)?s[oó]cio)\b/i,
          /\b(preciso\s+(?:de\s+)?aprova[cç][aã]o)\b/i,
          /\b(falar\s+com\s+(?:a\s+)?(?:esposa|marido|gerente|chefe|s[oó]cio))\b/i,
          /\b(consultar\s+(?:o\s+)?(?:s[oó]cio|gerente|chefe))\b/i,
        ],
      },
      {
        type: 'NEED',
        patterns: [
          /\b(n[aã]o\s+preciso)\b/i,
          /\b(n[aã]o\s+vejo\s+vantagem)\b/i,
          /\b(n[aã]o\s+faz\s+sentido|sem\s+necessidade)\b/i,
          /\b(n[aã]o\s+quero)\b/i,
        ],
      },
    ];

    for (const rule of rules) {
      for (const re of rule.patterns) {
        const m = text.match(re);
        if (m) {
          return {
            detected: true,
            type: rule.type,
            matchedPhrase: m[0],
          };
        }
      }
    }

    return { detected: false, type: null, matchedPhrase: null };
  }
}
