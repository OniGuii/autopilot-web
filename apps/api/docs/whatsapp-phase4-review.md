# WhatsApp Phase 4 Review — FollowUp Automation

**Status:** Implementado  
**Branch:** `cursor/whatsapp-phase4-implementation-dd93`  
**Base:** `whatsapp-phase4-design.md` + decisões P4-*  
**Pré-requisitos:** Fase 3 Outbound + FollowUp MVP

---

## 1. Escopo entregue

| Incluído | Excluído |
|---|---|
| `execute` → `WhatsappSendService` | Scheduler / BullMQ (P4-Q1) |
| `POST .../retry` (FAILED, máx 3) | IA / n8n / campanhas |
| `POST .../cancel` | Dashboard novo |
| approve → SCHEDULED (P4-A1) | Deploy produção |
| Metadata Message + FollowUp | |
| Audits FOLLOWUP_* Phase 4 | |

---

## 2. Decisões aplicadas

| ID | Implementação |
|---|---|
| **P4-A1** | approve → `SCHEDULED` (`scheduledAt` = dto \| existing \| now) |
| **P4-C1** | cancel em SUGGESTED\|APPROVED\|SCHEDULED |
| **P4-F1** | `assertConnected` antes de EXECUTING → 409 |
| **P4-R3** | `POST /retry` só FAILED |
| **P4-R4** | `FOLLOWUP_MAX_ATTEMPTS = 3` |
| **P4-S1/D5** | Message.metadata `{ source: "followup", followUpId, attempt }` |
| **P4-Q1** | Sem job |
| **P4-X1** | Lazy timeout EXECUTING > 5 min → FAILED |
| **P4-D1** | FollowUp nunca cria Message |
| **P4-D2** | EXECUTING obrigatório via `updateMany` |
| **P4-D3** | Message = fonte da verdade do envio |
| **P4-D4** | Retry gera nova Message |

---

## 3. Migrations

### `20260803180000_followup_metadata`

```sql
ALTER TABLE follow_ups ADD COLUMN metadata JSONB;
```

Usado para `{ attemptCount, lastError, executingTimedOutAt }`.

---

## 4. Endpoints

| Método | Path | Notas |
|---|---|---|
| `POST` | `/api/follow-ups/:id/approve` | → SCHEDULED |
| `POST` | `/api/follow-ups/:id/execute` | SCHEDULED → EXECUTING → EXECUTED\|FAILED |
| `POST` | `/api/follow-ups/:id/retry` | **novo** — só FAILED |
| `POST` | `/api/follow-ups/:id/cancel` | **novo** — não EXECUTED |
| (inalterados) | create/list/get/patch/reject/reschedule | |

Roles: OWNER \| ADMIN \| AGENT. Tenant: `JWT.cid`.

---

## 5. Fluxo execute

```text
SCHEDULED
  → assert WhatsApp CONNECTED (senão 409, sem EXECUTING)
  → attemptCount++
  → status EXECUTING
  → WhatsappSendService.send({ metadata: followup })
  → sucesso: EXECUTED + resultMessageId + FOLLOWUP_EXECUTE
  → falha: FAILED + resultMessageId? + FOLLOWUP_EXECUTE_FAILED
```

---

## 6. Retry

- Só `FAILED`
- Bloqueia se `attemptCount >= 3`
- Audit `FOLLOWUP_RETRY` ao entrar em EXECUTING
- Nova Message (P4-D4)

---

## 7. Cancelamento

Permitido: `SUGGESTED` \| `APPROVED` \| `SCHEDULED` → `CANCELLED`  
Negado: `EXECUTED` (e demais estados)  
Audit: `FOLLOWUP_CANCEL`

---

## 8. Auditoria

| Action | Quando |
|---|---|
| `FOLLOWUP_EXECUTE` | Sucesso |
| `FOLLOWUP_EXECUTE_FAILED` | Falha send ou timeout EXECUTING |
| `FOLLOWUP_RETRY` | Início do retry |
| `FOLLOWUP_CANCEL` | Cancel |
| (+ Fase 3) | `WHATSAPP_MESSAGE_SENT` / `FAILED` |

---

## 9. Integração WhatsApp

- `FollowUpModule` importa `WhatsappModule`
- `WhatsappSendService.assertConnected` + `send`
- Manual `/whatsapp/send` permanece com `source: whatsapp_send`

---

## 10. Multi-tenancy

Todas as queries FollowUp com `companyId = JWT.cid`.  
Send resolve instance pela mesma company. Cross-tenant → 404.

---

## 11. Riscos remanescentes

| Risco | Mitigação |
|---|---|
| EXECUTING órfão | P4-X1 lazy 5 min |
| Double execute | `updateMany` condicional |
| Instance cai após EXECUTING | FAILED + retry |
| Scheduler ausente | Execute manual |

---

## 12. Testes executados

```bash
cd apps/api
npx prisma migrate deploy
npx prisma generate
npm test -- --testPathPatterns='follow-up|whatsapp-send'
npm run build
```

---

## 13. Critérios de aceite

- [x] execute → WhatsappSendService  
- [x] EXECUTING obrigatório  
- [x] resultMessageId  
- [x] retry FAILED máx 3  
- [x] cancel  
- [x] metadata followup  
- [x] audits Phase 4  
- [x] P4-F1 409  
- [x] Sem scheduler/IA/filas  
- [x] Review + testes  

---

*Fim do review WhatsApp Fase 4.*
