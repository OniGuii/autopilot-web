# Operations & Observability Review — Fase 4.5 MVP

**Status:** Implementado  
**Branch:** `cursor/operations-implementation-dd93`  
**Base:** `operations-design.md` (aprovado com ajustes)

---

## 1. Escopo entregue

| Incluído | Excluído |
|---|---|
| `/api/ops` overview | IA / BullMQ |
| `/api/ops/metrics` + `/alerts` | Prometheus / Grafana / OTel |
| `/api/ops/health` | Slack / Discord / WebSocket |
| Audit Explorer | Frontend |
| Webhook Monitor (read-only) | Webhook replay |
| Reconcile messages/followups | Scheduler automático |
| Roles OWNER/ADMIN/AGENT | Alteração de `/health` público |

---

## 2. Endpoints

Prefixo global: `api`. Auth: JWT + company context.

| Método | Path | Roles |
|---|---|---|
| GET | `/api/ops` | OWNER, ADMIN, AGENT |
| GET | `/api/ops/metrics` | OWNER, ADMIN, AGENT |
| GET | `/api/ops/alerts` | OWNER, ADMIN, AGENT |
| GET | `/api/ops/health` | OWNER, ADMIN, AGENT |
| GET | `/api/ops/audit` | OWNER, ADMIN, AGENT |
| GET | `/api/ops/audit/:id` | OWNER, ADMIN, AGENT |
| GET | `/api/ops/webhooks` | OWNER, ADMIN, AGENT |
| GET | `/api/ops/webhooks/:id` | OWNER, ADMIN, AGENT |
| POST | `/api/ops/reconcile/messages` | OWNER, ADMIN |
| POST | `/api/ops/reconcile/followups` | OWNER, ADMIN |

Tenant: **sempre `JWT.cid`**. Sem cache.

---

## 3. Métricas (`GET /api/ops/metrics`)

```json
{
  "companyId": "...",
  "generatedAt": "...",
  "whatsappConnected": true,
  "totalMessages": 0,
  "pendingMessages": 0,
  "failedMessages": 0,
  "scheduledFollowUps": 0,
  "overdueFollowUps": 0,
  "executedFollowUps": 0
}
```

| Campo | Regra |
|---|---|
| `whatsappConnected` | Instance ativa `status === CONNECTED` |
| `totalMessages` | Messages da company (`deletedAt` null) |
| `pendingMessages` | `status = PENDING` |
| `failedMessages` | `status = FAILED` |
| `scheduledFollowUps` | FollowUp `SCHEDULED` |
| `overdueFollowUps` | `APPROVED\|SCHEDULED` ∧ `scheduledAt < now` |
| `executedFollowUps` | `EXECUTED` |

---

## 4. Alertas (`GET /api/ops/alerts`)

Códigos possíveis:
- `WHATSAPP_NOT_CONNECTED`
- `PENDING_MESSAGES_STALE` (PENDING > 5 min)
- `EXECUTING_FOLLOWUPS_STALE` (EXECUTING > 5 min)
- `FAILED_MESSAGES`
- `OVERDUE_FOLLOWUPS`
- `WEBHOOK_FAILURES_RECENT` (FAILED últimos 15 min)

---

## 5. Health (`GET /api/ops/health`)

```json
{
  "status": "ok",
  "postgres": "up",
  "redis": "up",
  "whatsapp": "up",
  "timestamp": "..."
}
```

| status | Quando |
|---|---|
| `ok` | postgres+redis+whatsapp up |
| `degraded` | postgres up; redis ou whatsapp down |
| `error` | postgres down |

Não altera `GET /health`, `/health/live`, `/health/ready`.

---

## 6. Audit Explorer

Filtros: `action`, `actorUserId`, `targetType`, `targetId`, `from`, `to`, `page`, `limit`  
Ordem: `occurredAt DESC`  
Listagem sem `before/after` pesados; GET `:id` retorna registro completo.

---

## 7. Webhook Monitor

Fonte: `webhook_events`  
Filtros: `status`, `eventType`, `from`, `to`, `page`, `limit`  
Sem replay / reprocessamento. Payload no detalhe pode ser truncado.

---

## 8. Reconcile

Body (default dry-run):

```json
{ "apply": false }
```

### Messages — `POST /api/ops/reconcile/messages`
- Match: `status=PENDING` ∧ `createdAt < now−5m`
- `apply=true`: → `FAILED`, `errorMessage=PENDING_TIMEOUT`, audit `OPS_RECONCILE_MESSAGES`

### FollowUps — `POST /api/ops/reconcile/followups`
- Match: `status=EXECUTING` ∧ `updatedAt < now−5m`
- `apply=true`: → `FAILED`, `cancelReason=EXECUTING_TIMEOUT`, audit `OPS_RECONCILE_FOLLOWUPS`

Resposta:

```json
{
  "apply": false,
  "encontrados": 2,
  "corrigidos": 0,
  "ignorados": 2
}
```

AGENT → 403 nestes endpoints.

---

## 9. Arquivos

| Arquivo | Papel |
|---|---|
| `src/modules/ops/ops.module.ts` | Módulo |
| `src/modules/ops/ops.controller.ts` | HTTP |
| `src/modules/ops/ops.service.ts` | Lógica |
| `src/modules/ops/redis-ping.ts` | Health Redis |
| `src/modules/ops/dto/*` | DTOs |
| `docs/operations-review.md` | Este review |

Migrations: **nenhuma** (reutiliza schema existente).

---

## 10. Testes executados

```bash
cd apps/api
npm test -- --testPathPatterns='ops'
npm test
npm run build
```

Resultado: **ops 15 passed**; suite completa **11 suites / 63 tests passed**; `nest build` OK.

---

## 11. Riscos remanescentes

| Risco | Mitigação |
|---|---|
| Reconcile apply agressivo | dry-run default; só stale >5m |
| Contagens caras | índices company/status existentes |
| Redis sem client oficial | PING TCP leve |
| AGENT vê ops | somente leitura; sem reconcile |

---

## 12. Critérios de aceite

- [x] Endpoints ops autorizados  
- [x] Métricas + alertas + health  
- [x] Audit + webhooks read-only  
- [x] Reconcile dry-run/apply + audits  
- [x] Roles OWNER/ADMIN/AGENT  
- [x] Sem IA/filas/Prometheus/frontend/replay  
- [x] Review + testes + build  

---

*Fim do review Operations & Observability MVP.*
