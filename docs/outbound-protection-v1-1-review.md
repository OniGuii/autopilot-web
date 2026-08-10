# Outbound V1.1 — Protection Layer Review

**Status:** Implementado  
**Branch:** `cursor/outbound-protection-v1-1-dd93`  
**Design:** `docs/outbound-sales-engine-v1-design.md` §8 / §13  
**Data:** 2026-08-10

---

## Objetivo

Criar a **camada de proteção** para outbound proativo: caps por empresa/dia/hora, cooldown por lead, spacing, janela horária, opt-out por keyword, suppress list, métricas e auditoria — **sem** importador, campanhas ou first-touch.

---

## Entregue

| Item | Status |
|------|--------|
| `CompanyOutboundProtectionSettings` + RLS | ✅ |
| `OutboundSuppressEntry` + RLS | ✅ |
| `OutboundProtectionService.canSendProactive` | ✅ |
| Gate em `WhatsappSendService` (sources proativas) | ✅ |
| Soft-gate Recovery schedule/execute | ✅ |
| Keyword opt-out no inbound WhatsApp | ✅ |
| Auto-suppress em lead `LOST` | ✅ |
| APIs `/api/outbound/protection/*` | ✅ |
| Dashboard + UI `/outbound/protection` | ✅ |
| Audits `OUTBOUND_*` | ✅ |
| Prometheus `outbound_protection_*` / `outbound_suppress_*` / `outbound_opt_out_*` | ✅ |
| Testes unitários + e2e | ✅ |
| Docs review | ✅ |

---

## Fora do escopo (V1.2+)

- Lead Import CSV/XLSX  
- Outbound Campaign  
- First Touch Engine  
- Sequências tipadas além da ponte Recovery  

---

## Fluxo

```text
Proactive send (source ∈ ai_recovery | outbound_first_touch | outbound_nurture)
  → OutboundProtectionService.canSendProactive
      1. suppress / LOST / CONVERTED          (sempre)
      2. daily/hourly cap + hours + cooldown  (se settings.enabled)
  → allow → WhatsappSendService.createPendingMessage
  → block → ConflictException + OUTBOUND_PROACTIVE_BLOCKED

Inbound body com keyword (pare/stop/sair/…)
  → OutboundSuppressService.maybeOptOutFromInbound
  → suppress active + OUTBOUND_OPT_OUT
```

Human `whatsapp_send` e AUTO `ai_agent` **não** passam pelos caps (só proactive).

---

## Policy (defaults)

| Campo | Default |
|-------|---------|
| enabled | false |
| dailyProactiveCap | 50 |
| hourlyProactiveCap | 15 |
| leadCooldownMinutes | 60 |
| minSpacingSeconds | 30 |
| allowedHours | null |
| suppressOnKeywords | pare, stop, sair, cancelar |
| autoSuppressOnLost | true |

---

## APIs

- `GET/PATCH /api/outbound/protection/settings` (OWNER/ADMIN)
- `GET /api/outbound/protection/dashboard` (OWNER/ADMIN)
- `GET/POST /api/outbound/protection/suppress` (OWNER/ADMIN)
- `DELETE /api/outbound/protection/suppress/:id` (OWNER/ADMIN)

---

## Métricas Prometheus

- `outbound_protection_allowed_total{source}`
- `outbound_protection_blocked_total{reason}`
- `outbound_suppress_added_total`
- `outbound_suppress_removed_total`
- `outbound_opt_out_total`
- `outbound_proactive_remaining_daily`
- `outbound_proactive_remaining_hourly`

---

## Auditoria

- `OUTBOUND_PROTECTION_UPDATED`
- `OUTBOUND_SUPPRESS_ADDED` / `OUTBOUND_SUPPRESS_REMOVED`
- `OUTBOUND_OPT_OUT`
- `OUTBOUND_PROACTIVE_BLOCKED`

---

## Notas de comportamento

1. **Suppress sempre aplica** em sources proativas, mesmo com `enabled=false`.  
2. Caps temporários no Recovery → soft skip (`OUTBOUND_PROTECTED`), FollowUp permanece `SCHEDULED`.  
3. Suppress permanente / LOST / CONVERTED → Recovery cancela fluxo.  
4. Sem blast; um único caminho de send.

---

## PARAR

Não iniciar V1.2 (Import / Campaign / First Touch) nesta entrega.
