# Outbound V1.3 — First Touch Engine Review

**Status:** Implementado  
**Branch:** `cursor/outbound-first-touch-v1-3-dd93`  
**Design:** `docs/outbound-first-touch-v1-3-design.md`  
**Base:** Protection V1.1 · Import V1.2 · FollowUp · WhatsApp · 11D · 11E · KB  
**Data:** 2026-08-10

---

## Objetivo

Implementar o **D0 (First Touch)**: gerar abordagem inicial, criar/reusar Conversation, FollowUp `OUTBOUND_FIRST_TOUCH`, aprovar ou auto-agendar, enviar via `WhatsappSendService`, promover `NEW→CONTACTED`.

---

## Entregue

| Item | Status |
|------|--------|
| Modos `OFF` / `HUMAN_APPROVE` / `AUTO_SEND` | ✅ |
| `CompanyFirstTouchSettings` + migration + RLS | ✅ |
| Generate D0 (template vertical + KB opcional) | ✅ |
| Resolve/create Conversation OPEN | ✅ |
| Seed `salesMemory` DISCOVERY (11E) | ✅ |
| FollowUp `OUTBOUND_FIRST_TOUCH` | ✅ |
| Approve / reject | ✅ |
| Source map → `outbound_first_touch` (Protection) | ✅ |
| Side-effect `NEW→CONTACTED` + `lastOutboundAt` | ✅ |
| Dashboard métricas | ✅ |
| UI `/outbound/first-touch` | ✅ |
| Audits `FIRST_TOUCH_*` | ✅ |
| Prometheus `first_touch_*` | ✅ |
| Unit + e2e | ✅ |
| Review + executive | ✅ |

---

## Fora do escopo (PARAR)

- Campaign Engine  
- Sequências outbound tipadas / V1.4  
- A/B tests  
- Blast / multi-número  

---

## Fluxo

```text
Settings mode ≠ OFF
  → POST /generate (leads NEW elegíveis)
  → Conversation OPEN|IDLE + FollowUp OUTBOUND_FIRST_TOUCH
       HUMAN_APPROVE → SUGGESTED
       AUTO_SEND → SCHEDULED
  → approve → SCHEDULED
  → execute (FollowUp / DueScanner) → WhatsappSendService
       source=outbound_first_touch → Protection V1.1
  → SENT → lastOutboundAt + NEW→CONTACTED
  → Recovery 11D elegível no scanner (não agenda no D0)
```

---

## APIs

| Método | Path |
|--------|------|
| GET/PATCH | `/api/outbound/first-touch/settings` |
| GET | `/api/outbound/first-touch/dashboard` |
| GET | `/api/outbound/first-touch/follow-ups` |
| POST | `/api/outbound/first-touch/generate` |
| POST | `/api/outbound/first-touch/follow-ups/:id/approve` |
| POST | `/api/outbound/first-touch/follow-ups/:id/reject` |

Envio: reusa `POST /api/follow-ups/:id/execute`.

Roles: OWNER / ADMIN.

---

## Dashboard

- Leads elegíveis  
- D0 gerados / aprovados / enviados / entregues / respondidos  
- Taxa de resposta  

---

## Observabilidade

**Audits:** `FIRST_TOUCH_CREATED` · `FIRST_TOUCH_APPROVED` · `FIRST_TOUCH_SENT` · `FIRST_TOUCH_FAILED` (+ settings/rejected)

**Prometheus:**  
`first_touch_created_total` · `first_touch_sent_total` · `first_touch_reply_rate` (+ failed)

---

## Reuso

| Sistema | Uso |
|---------|-----|
| V1.1 Protection | Gate no send `outbound_first_touch` |
| V1.2 Import | Fonte de leads + metadata |
| KB | Grounding opcional no D0 |
| 11D Recovery | Hand-off após CONTACTED + lastOutboundAt |
| 11E Sales Brain | Seed DISCOVERY; qualificação pós-reply |

---

## PARAR

Não iniciar V1.4. Não iniciar Campaign Engine.
