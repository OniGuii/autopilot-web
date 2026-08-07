# Fase 11D — AI Sales Agent Recovery Engine Review

**Status:** Implementado  
**Branch:** `cursor/ai-sales-agent-11d-dd93`  
**Design:** `docs/ai-sales-agent-mvp-design.md` §6  
**Data:** 2026-08-07

---

## Objetivo

Recovery automático de leads frios (**CONTACTED** / **RESPONDED**) reutilizando FollowUp Scheduler + BullMQ + WhatsApp + AI Settings + Audit + Metrics — **sem** motor paralelo de envio.

---

## Entregue

| Item | Status |
|------|--------|
| `CompanyRecoverySettings` (policy por empresa) | ✅ |
| Presets R1 D+1 / R2 D+3 / R3 D+7 (editáveis) | ✅ |
| FollowUp `type=AI_RECOVERY`, `source=ai_recovery`, `SCHEDULED` | ✅ |
| Scanner de elegibilidade (`AiRecoveryScanner`) | ✅ |
| Execução via `FollowUpService.executeDue` → `WhatsappSendService` | ✅ |
| Mensagem composta (contexto + KB + intent) | ✅ |
| Stop: reply / converted / lost / takeover / maxAttempts | ✅ |
| Dashboard + UI `/ai/recovery` | ✅ |
| Audits `AI_RECOVERY_*` | ✅ |
| Prometheus `ai_recovery_*` | ✅ |
| Testes unitários + e2e | ✅ |
| Docs review + executive | ✅ |

---

## Fora do escopo

- **11E** ROI completo (economia, custo OpenAI)  
- Motor de envio paralelo  
- Opt-out channel-level além das stop conditions já cobertas  

---

## Fluxo

```text
AiRecoveryScanner (ASYNC_FOLLOWUP_ENABLED)
  → empresas com recovery.enabled
  → leads CONTACTED|RESPONDED elegíveis
  → cria FollowUp AI_RECOVERY SCHEDULED (cadência R1/R2/R3)
  → FollowUpDueScanner / BullMQ followup-scheduler
  → prepareExecution (stop checks + regenera body)
  → WhatsappSendService.send (metadata.source=ai_recovery)
  → AI_RECOVERY_SENT + metrics
```

Stop hooks:

- Inbound WhatsApp → `stopOnInboundReply`
- `agentPaused` (COMPLAINT/HUMAN) → `stopOnHumanTakeover`
- Lead `CONVERTED`/`LOST` → `stopOnLeadTerminal` (+ `AI_RECOVERY_CONVERTED` se houve EXECUTED)

---

## Policy (defaults)

| Campo | Default |
|-------|---------|
| enabled | false |
| maxAttempts | 3 |
| cooldownHours | 24 |
| stopOnReply | true |
| stopOnHumanTakeover | true |
| cadenceHours | [24, 72, 168] |
| allowedHours | null (qualquer) |

---

## APIs

- `GET/PATCH /api/ai/recovery/settings` (OWNER/ADMIN)
- `GET /api/ai/recovery/dashboard` (OWNER/ADMIN)

---

## Como validar

1. Settings Recovery → ativar + cadência R1/R2/R3.  
2. Agent mode ≠ OFF; WhatsApp CONNECTED.  
3. Lead CONTACTED com outbound sem inbound → FollowUp `AI_RECOVERY` SCHEDULED.  
4. Quando due → outbound `source=ai_recovery` + audit `AI_RECOVERY_SENT`.  
5. Inbound do cliente cancela pendentes (`AI_RECOVERY_STOPPED:REPLY`).  
6. `/ai/recovery` mostra leads / tentativas / recuperados / conversão.  

---

## Critérios de aceite

| Critério | Resultado |
|----------|-----------|
| Recovery automático | ✅ |
| Sem loops / spam (pending único, cooldown, rate, max 3) | ✅ |
| Respeita reply | ✅ |
| Respeita takeover | ✅ |
| Dashboard operacional | ✅ |
| Métricas + auditoria | ✅ |
| Build / testes | ✅ local (ver executive report) |
