# Fase 11E.2 — Lead Scoring Review

**Status:** Implementado  
**Branch:** `cursor/ai-sales-agent-11e2-dd93`  
**Design:** `docs/ai-sales-agent-11e-design.md` §3  
**Data:** 2026-08-08

---

## Objetivo

Motor de **score comercial 0–100** determinístico (sem OpenAI), persistido na Sales Memory (11E.1), com temperatura COLD/WARM/HOT.

---

## Entregue

| Item | Status |
|------|--------|
| Campos `score`, `temperature`, `lastScoreAt` em `salesMemory` | ✅ |
| `LeadScoringService` calculate / updateScore / getTemperature | ✅ |
| Pesos documentados (`LEAD_SCORE_WEIGHTS`) | ✅ |
| Recálculo pós Sales Memory no pipeline inbound | ✅ |
| Espelho `Lead.score` | ✅ |
| Recovery usa tom por temperatura (cadência intacta) | ✅ |
| Dashboard backend HOT/WARM/COLD + conversões | ✅ |
| Audits `LEAD_SCORE_*` / `LEAD_BECAME_*` | ✅ |
| Prometheus `lead_score_{hot,warm,cold}_total` | ✅ |
| Testes + docs | ✅ |

---

## Fora do escopo

- **11E.3** Objection Engine  
- **11E.4** Next Best Action  
- **11E.5** Purchase Intent  
- Alterar cadência Recovery  

---

## Temperature

| Band | Score |
|------|-------|
| COLD | 0–39 |
| WARM | 40–69 |
| HOT | 70–100 |

---

## Pesos (resumo)

**+** produto, preço, orçamento, pagamento, entrega, cidade, urgência, intenção de compra, respondeu recovery, múltiplas interações  

**−** objeção, lead LOST, inatividade, outbound sem resposta  

Detalhe: `LEAD_SCORE_WEIGHTS` em `ai.constants.ts` e endpoint dashboard.

---

## Fluxo

```text
Inbound → classify → SalesMemory.update → LeadScoring.updateScore
  → persist salesMemory.score/temperature
  → mirror Lead.score
  → audit + metrics
  → ASSIST/AUTO (inalterado)
```

---

## APIs

| Método | Path |
|--------|------|
| GET | `/api/ai/lead-scoring/dashboard` |

---

## Critérios

| Critério | Resultado |
|----------|-----------|
| Score crescente/decrescente | ✅ |
| Mudança de temperatura | ✅ |
| Recovery expõe/usa score | ✅ |
| Multi-tenant | ✅ |
| Build / lint / testes | ✅ |
