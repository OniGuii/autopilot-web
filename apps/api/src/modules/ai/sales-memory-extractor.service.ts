import { Injectable } from '@nestjs/common';
import { AiIntent } from '@prisma/client';
import {
  SALES_MEMORY_BUDGET_MAX_CHARS,
  SALES_MEMORY_CITY_MAX_CHARS,
  SALES_MEMORY_SLOT_MAX_CHARS,
} from './ai.constants';
import type {
  SalesMemoryPatch,
  SalesObjectionCode,
  SalesPurchaseIntentLevel,
  SalesUrgency,
} from './sales-memory.types';

/**
 * 11E.1 — deterministic slot extraction (no OpenAI / no extra cost).
 * Detects: orçamento, cidade, produto, pagamento, urgência (+ objeção / intent compra leves).
 */
@Injectable()
export class SalesMemoryExtractorService {
  extract(input: {
    message: string;
    intent?: AiIntent | null;
  }): SalesMemoryPatch {
    const text = (input.message ?? '').trim();
    if (!text) return {};

    const patch: SalesMemoryPatch = {};
    const budget = this.extractBudget(text);
    if (budget) patch.budget = budget;

    const city = this.extractCity(text);
    if (city) patch.city = city;

    const products = this.extractProductInterest(text, input.intent);
    if (products.length > 0) patch.productInterest = products;

    const payment = this.extractPayment(text, input.intent);
    if (payment) patch.paymentPreference = payment;

    const delivery = this.extractDelivery(text, input.intent);
    if (delivery) patch.deliveryPreference = delivery;

    const urgency = this.extractUrgency(text);
    if (urgency) patch.urgency = urgency;

    const objection = this.extractObjection(text);
    if (objection) patch.lastObjection = objection;

    const purchase = this.extractPurchaseIntent(text, input.intent);
    if (purchase) patch.purchaseIntentLevel = purchase;

    return patch;
  }

  private extractBudget(text: string): string | null {
    const patterns = [
      /(?:or[cç]amento|budget|tenho|posso\s+pagar|at[eé]|no\s+m[aá]ximo)\s*(?:de\s+|uns\s+|umas\s+)?(?:r\$\s*)?(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?|\d+)/i,
      /(?:r\$\s*)(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?|\d+)\s*(?:reais)?/i,
      /(\d{2,6})\s*(?:reais|rs)\b/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m?.[1]) {
        return this.clip(
          `R$ ${m[1].replace(/\s/g, '')}`,
          SALES_MEMORY_BUDGET_MAX_CHARS,
        );
      }
    }
    if (/\b(barato|mais\s+barato|desconto|promo)/i.test(text)) {
      return this.clip('sensível a preço', SALES_MEMORY_BUDGET_MAX_CHARS);
    }
    return null;
  }

  private extractCity(text: string): string | null {
    const patterns = [
      /(?:moro\s+em|sou\s+de|fico\s+em|moro\s+no|moro\s+na|em)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÜ][\wáéíóúâêôãõüçÁÉÍÓÚÂÊÔÃÕÜ]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÜ][\wáéíóúâêôãõüçÁÉÍÓÚÂÊÔÃÕÜ]+){0,2})/i,
      /(?:cidade|entrega(?:r)?\s+(?:em|para)|frete\s+(?:para|pra))\s+([A-Za-zÁ-ú][\wáéíóúâêôãõüç]+(?:\s+[A-Za-zÁ-ú][\wáéíóúâêôãõüç]+){0,2})/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m?.[1]) {
        const city = m[1].trim();
        if (this.isStopCityToken(city)) continue;
        return this.clip(city, SALES_MEMORY_CITY_MAX_CHARS);
      }
    }
    return null;
  }

  private extractProductInterest(
    text: string,
    intent?: AiIntent | null,
  ): string[] {
    const found: string[] = [];
    const named = text.match(
      /(?:interesse\s+(?:no|na|em)|quero\s+(?:o|a|um|uma)|sobre\s+o|produto)\s+([A-Za-zÁ-ú0-9][\wáéíóúâêôãõüç0-9\- ]{1,40})/i,
    );
    if (named?.[1]) {
      const p = this.cleanProduct(named[1]);
      if (p) found.push(p);
    }
    const plano = text.match(/\b(plano\s+\w+)/i);
    if (plano?.[1])
      found.push(this.clip(plano[1], SALES_MEMORY_SLOT_MAX_CHARS));

    if (
      found.length === 0 &&
      intent === AiIntent.PRODUCT &&
      text.length > 3 &&
      text.length < 80
    ) {
      found.push(this.clip(text, SALES_MEMORY_SLOT_MAX_CHARS));
    }
    return [...new Set(found)].slice(0, 3);
  }

  private extractPayment(
    text: string,
    intent?: AiIntent | null,
  ): string | null {
    if (/\b(pix)\b/i.test(text)) return 'Pix';
    if (/\b(cart[aã]o|cr[eé]dito|d[eé]bito)\b/i.test(text)) return 'Cartão';
    if (/\b(boleto)\b/i.test(text)) return 'Boleto';
    if (/\b(\d{1,2})\s*x\b/i.test(text) || /\bparcel/i.test(text)) {
      const m = text.match(/\b(\d{1,2})\s*x\b/i);
      return m ? `${m[1]}x` : 'Parcelado';
    }
    if (intent === AiIntent.PAYMENT && /\b(pag|forma)\b/i.test(text)) {
      return 'a definir';
    }
    return null;
  }

  private extractDelivery(
    text: string,
    intent?: AiIntent | null,
  ): string | null {
    if (/\b(retirada|buscar|retiro)\b/i.test(text)) return 'Retirada';
    if (/\b(sedex|pac|motoboy|correios)\b/i.test(text)) {
      const m = text.match(/\b(sedex|pac|motoboy|correios)\b/i);
      return m ? this.capitalize(m[1]) : 'Entrega';
    }
    if (
      /\b(entrega|frete|prazo)\b/i.test(text) ||
      intent === AiIntent.DELIVERY
    ) {
      if (/\b(urgente|hoje|amanh[aã])\b/i.test(text)) return 'Entrega rápida';
      return 'Entrega';
    }
    return null;
  }

  private extractUrgency(text: string): SalesUrgency | null {
    if (
      /\b(hoje|agora|urgente|o\s+quanto\s+antes|preciso\s+j[aá])\b/i.test(text)
    ) {
      return 'HIGH';
    }
    if (/\b(essa\s+semana|em\s+breve|logo)\b/i.test(text)) {
      return 'MEDIUM';
    }
    if (
      /\b(sem\s+pressa|depois|mais\s+pra\s+frente|quando\s+der)\b/i.test(text)
    ) {
      return 'LOW';
    }
    return null;
  }

  private extractObjection(text: string): SalesObjectionCode | null {
    if (
      /\b(caro|car[ií]ssimo|fora\s+do\s+or[cç]amento|muito\s+caro)\b/i.test(
        text,
      )
    ) {
      return 'CARO';
    }
    if (/\b(sem\s+tempo|agora\s+n[aã]o|depois\s+falo)\b/i.test(text)) {
      return 'SEM_TEMPO';
    }
    if (
      /\b(vou\s+pensar|preciso\s+pensar|me\s+d[aá]\s+um\s+tempo)\b/i.test(text)
    ) {
      return 'PRECISO_PENSAR';
    }
    if (
      /\b(s[oó]cio|esposa|marido|gerente|chefe)\b/i.test(text) &&
      /\b(falar|ver|consultar|combinar)\b/i.test(text)
    ) {
      return 'VER_COM_SOCIO';
    }
    if (
      /\b(concorrente|mais\s+barato\s+no|vi\s+em\s+outro|compar)/i.test(text)
    ) {
      return 'COMPARANDO_CONCORRENTE';
    }
    return null;
  }

  private extractPurchaseIntent(
    text: string,
    intent?: AiIntent | null,
  ): SalesPurchaseIntentLevel | null {
    if (
      /\b(vamos\s+fechar|quero\s+comprar|pode\s+emitir|fechamos|manda\s+o\s+pix)\b/i.test(
        text,
      )
    ) {
      return 'HIGH';
    }
    if (
      /\b(como\s+pago|manda\s+o?\s*link|quero\s+fechar|pode\s+reservar)\b/i.test(
        text,
      )
    ) {
      return 'MEDIUM';
    }
    if (
      intent === AiIntent.PAYMENT ||
      /\b(forma\s+de\s+pagamento)\b/i.test(text)
    ) {
      return 'LOW';
    }
    return null;
  }

  private isStopCityToken(city: string): boolean {
    return /^(que|uma|um|meu|minha|casa|apto|apartamento|trabalho|breve|conta|pix)$/i.test(
      city.trim(),
    );
  }

  private cleanProduct(raw: string): string | null {
    const t = raw.replace(/[?.!,;]+$/g, '').trim();
    if (t.length < 2) return null;
    if (/^(isso|algo|mais|saber|informa)/i.test(t)) return null;
    return this.clip(t, SALES_MEMORY_SLOT_MAX_CHARS);
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  private clip(s: string, max: number): string {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : t.slice(0, max);
  }
}
