# Fase 11E.5 — Purchase Intent Review

**Status:** Implementado  
**Branch:** `cursor/ai-sales-agent-11e5-dd93`  
**Design:** `docs/ai-sales-agent-11e-design.md` §6  
**Base:** 11E.4 NBA (`docs/ai-sales-agent-11e4-review.md`)  
**Data:** 2026-08-08

---

## Objetivo

Determinar o **nível de intenção de compra** do lead (0–100 + faixa) a partir de dados já existentes — sem OpenAI adicional e sem alterar regras AUTO.

---

## Entregue

| Item | Status |
|------|--------|
| `PurchaseIntentService` | ✅ |
| Campos `purchaseIntent`, `purchaseIntentScore`, `purchaseIntentUpdatedAt` | ✅ |
| Faixas VERY_LOW…VERY_HIGH | ✅ |
| Pipeline pós-NBA (contexto only) | ✅ |
| Dashboard `GET /api/ai/purchase-intent/dashboard` | ✅ |
| Read APIs conversation/lead | ✅ |
| UI card Purchase Intent | ✅ |
| Audits `PURCHASE_INTENT_*` | ✅ |
| Prometheus `purchase_intent_*_total` | ✅ |
| Testes + docs | ✅ |

---

## Fora do escopo

- **Fase 12**  
- Alterar regras AUTO  
- Auto-conversão / novos envios  
- OpenAI adicional  

---

## Faixas

| Band | Score |
|------|-------|
| VERY_LOW | 0–24 |
| LOW | 25–49 |
| MEDIUM | 50–69 |
| HIGH | 70–89 |
| VERY_HIGH | 90–100 |

---

## Sinais (resumo)

**+** HOT/WARM, lead score, preço/pagamento/entrega/garantia, produto/orçamento/cidade, NBA OFFER_CLOSE, resposta rápida, sem objeção  

**−** LOST, COMPLAINT, AUTHORITY, objeções repetidas, recovery ignorado, silêncio/cooldown  

Pesos: `PURCHASE_INTENT_WEIGHTS` em `ai.constants.ts`.

---

## ASSIST / AUTO

| Mode | Comportamento |
|------|----------------|
| ASSIST | Persiste + mostra no card; HIGH/VERY_HIGH aparece no texto sugerido |
| AUTO | Metadata `purchaseIntent` como contexto — **nunca** dispara ações novas |

---

## APIs

| Método | Path |
|--------|------|
| GET | `/api/ai/purchase-intent/dashboard` |
| GET | `/api/ai/purchase-intent/conversation/:id` |
| GET | `/api/ai/purchase-intent/lead/:id` |

---

## Nota de modelo

`purchaseIntentLevel` (11E.1: NONE/LOW/MEDIUM/HIGH) permanece como slot do extrator.  
`purchaseIntent` (11E.5: VERY_LOW…VERY_HIGH) é a faixa calculada do motor.

---

## Critérios

| Critério | Resultado |
|----------|-----------|
| HOT + orçamento + produto + pagamento → VERY_HIGH | ✅ |
| Morno → MEDIUM | ✅ |
| Frio → LOW | ✅ |
| Perdido → VERY_LOW | ✅ |
| AUTHORITY / recovery ignorado reduzem | ✅ |
| Multi-tenant | ✅ |
| Build / lint / testes | ✅ |
