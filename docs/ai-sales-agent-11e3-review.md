# Fase 11E.3 — Objection Engine Review

**Status:** Implementado  
**Branch:** `cursor/ai-sales-agent-11e3-dd93`  
**Design:** `docs/ai-sales-agent-11e-design.md` §4 (+ catálogo operacional PRICE/TIME/…)  
**Data:** 2026-08-08

---

## Objetivo

Detectar objeções comerciais por regras, persistir em Sales Memory, gerar resposta contextual (KB + intent + memória + temperatura) e decidir ASSIST / AUTO estreito / escalação humana — **sem vender sozinho** e **sem afrouxar regras AUTO de intent (11C)**.

---

## Entregue

| Item | Status |
|------|--------|
| Enum `PRICE \| TIME \| TRUST \| COMPARISON \| AUTHORITY \| NEED \| UNKNOWN` | ✅ |
| `ObjectionDetectionService` (regras PT-BR) | ✅ |
| `ObjectionEngineService` (resposta + escalation + dashboard) | ✅ |
| Memória `lastObjection` + `objectionHistory[]` | ✅ |
| Pipeline inbound após Lead Scoring | ✅ |
| ASSIST → FollowUp `AI_REPLY` SUGGESTED | ✅ |
| AUTO só PRICE/TIME/TRUST + WARM/HOT | ✅ |
| Nunca AUTO AUTHORITY/COMPARISON/NEED/UNKNOWN | ✅ |
| `requiresHumanReason` | ✅ |
| Dashboard top objeções | ✅ |
| Audits `OBJECTION_*` | ✅ |
| Prometheus `objection_*_total` | ✅ |
| Testes + docs | ✅ |

---

## Fora do escopo

- **11E.4** Next Best Action  
- **11E.5** Purchase Intent  
- Novas integrações externas / OpenAI  
- Alterar allowlist AUTO por intent (11C)

---

## Tipos → estratégias

| Tipo | Estratégia de resposta |
|------|------------------------|
| PRICE | valor · benefício · alternativa |
| TIME | urgência · disponibilidade · reserva |
| TRUST | reputação · garantia · suporte |
| COMPARISON | diferenciais (só fatos KB) |
| AUTHORITY | ajudar decisão (+ escalate) |
| NEED | explorar problema (+ escalate) |

---

## AUTO / ASSIST

```text
ASSIST (default): sempre SUGGESTED com corpo do Objection Engine
AUTO objection:   PRICE|TIME|TRUST ∩ temperature ∈ {WARM,HOT} ∩ !requiresHuman
                  + guardrails 11C (pause, confidence, rate, anti-loop…)
Nunca AUTO:       AUTHORITY | COMPARISON | NEED | UNKNOWN | COLD
```

Regras `neverAuto` por intent (COMPLAINT/HUMAN/UNKNOWN/non-safe) **permanecem**; o caminho objection é allowlist **adicional estreita**, não relaxamento geral.

---

## Escalation (`requiresHumanReason`)

| Razão | Quando |
|-------|--------|
| `OBJECTION_AUTHORITY` | tipo AUTHORITY |
| `OBJECTION_NEED` | tipo NEED |
| `OBJECTION_REPEATED` | mesmo tipo ≥ 2× no histórico |
| `HOT_LEAD_NO_ADVANCE` | HOT + ≥2 objeções + purchaseIntent NONE/LOW |

---

## Fluxo

```text
Inbound → classify → SalesMemory → LeadScoring
  → ObjectionEngine.handle (detect → persist → reply → audit)
  → ASSIST SUGGESTED | AUTO send (estreito) | escalate
```

---

## APIs

| Método | Path |
|--------|------|
| GET | `/api/ai/objections/dashboard` |

---

## Critérios

| Critério | Resultado |
|----------|-----------|
| Detecção por regras | ✅ |
| Resposta contextual | ✅ |
| AUTO / ASSIST | ✅ |
| Escalation | ✅ |
| Multi-tenant (companyId) | ✅ |
| Build / lint / testes | ✅ |
