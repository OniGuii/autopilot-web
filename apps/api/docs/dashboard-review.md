# Dashboard Review — Analytics MVP

**Status:** Implementado  
**Branch:** `cursor/dashboard-implementation-dd93`  
**Base design:** `dashboard-design.md` (aprovado com decisões congeladas)

---

## 1. Arquitetura

```text
Cliente (Bearer JWT com cid/mid/role)
  │
  ├─ GET /api/dashboard
  ├─ GET /api/dashboard/overview
  ├─ GET /api/dashboard/leads
  ├─ GET /api/dashboard/conversations
  └─ GET /api/dashboard/followups
           │
           ▼
     DashboardController
       Guards: JwtAuthGuard → CompanyContextGuard → RolesGuard
       Roles: OWNER | ADMIN | AGENT
           │
           ▼
     DashboardService
       Prisma count / groupBy em paralelo (Promise.all)
       companyId = JWT.cid · deletedAt IS NULL
```

Somente leitura. Sem cache. Sem frontend/gráficos. Sem AuditLog.

---

## 2. Endpoints

| Método | Path | Conteúdo |
|---|---|---|
| `GET` | `/api/dashboard` | payload completo |
| `GET` | `/api/dashboard/overview` | KPIs de leads overview |
| `GET` | `/api/dashboard/leads` | `byStatus` |
| `GET` | `/api/dashboard/conversations` | KPIs de conversas/mensagens |
| `GET` | `/api/dashboard/followups` | KPIs de follow-ups |

Query opcional: `from`, `to` (ISO datetime, `from <= to`).

---

## 3. KPIs (decisões congeladas)

### Overview
| Campo | Definição |
|---|---|
| `totalLeads` | count leads |
| `newLeads` | status NEW |
| `convertedLeads` | status CONVERTED |
| `lostLeads` | status LOST |
| `conversionRate` | `converted / total` decimal **0–1** (4 casas) |
| `period` | `{ from, to }` |

### Leads
| Campo | Definição |
|---|---|
| `byStatus` | objeto com todas as chaves `LeadStatus` (zeros preenchidos) |

### Conversations
| Campo | Definição |
|---|---|
| `openConversations` | status **OPEN + IDLE** |
| `closedConversations` | status **CLOSED + ARCHIVED** |
| `messagesSent` | direction OUTBOUND |
| `messagesReceived` | direction INBOUND |
| `avgMessagesPerConversation` | `(sent+received) / totalConversations` (0–n, 4 casas) |

### FollowUps
| Campo | Definição |
|---|---|
| `pending` | SUGGESTED + APPROVED + SCHEDULED |
| `overdue` | APPROVED\|SCHEDULED ∧ `scheduledAt < now` — **ignora período** |
| `executed` | EXECUTED |
| `executionRate` | `executed / (executed + pending)` decimal 0–1 |

Período (`from`/`to`) filtra `createdAt` das entidades (exceto overdue).

---

## 4. Exemplo `GET /api/dashboard`

```json
{
  "companyId": "...",
  "generatedAt": "...",
  "period": { "from": null, "to": null },
  "overview": {
    "totalLeads": 200,
    "newLeads": 40,
    "convertedLeads": 25,
    "lostLeads": 30,
    "conversionRate": 0.125,
    "period": { "from": null, "to": null }
  },
  "leads": {
    "byStatus": {
      "NEW": 40,
      "CONTACTED": 50,
      "RESPONDED": 35,
      "QUALIFIED": 20,
      "CONVERTED": 25,
      "LOST": 30
    },
    "period": { "from": null, "to": null }
  },
  "conversations": {
    "openConversations": 12,
    "closedConversations": 40,
    "messagesSent": 500,
    "messagesReceived": 400,
    "avgMessagesPerConversation": 4.5,
    "period": { "from": null, "to": null }
  },
  "followUps": {
    "pending": 48,
    "overdue": 15,
    "executed": 120,
    "executionRate": 0.7143,
    "period": { "from": null, "to": null }
  }
}
```

---

## 5. Multi-tenancy & regras

- `JWT.cid` obrigatório (`CompanyContextGuard`)
- Soft-deleted excluídos
- Sem mutações
- Sem cache

---

## 6. Arquivos

```text
src/modules/dashboard/
  dashboard.module.ts
  dashboard.controller.ts
  dashboard.service.ts
  dto/dashboard-query.dto.ts
docs/dashboard-review.md
```

---

## 7. Riscos

| Risco | Nota |
|---|---|
| Contagens all-time em bases grandes | índices existentes; cache em fase futura |
| `avgMessagesPerConversation` usa total de conversations no período | mensagens órfãs de conv fora do período não distorcem denominador do mesmo filtro createdAt |
| Tenant Extension off | isolamento app-layer |

---

## 8. Critérios de aceite

- [x] 5 endpoints REST somente leitura  
- [x] KPIs Overview / Leads / Conversations / FollowUps  
- [x] Open=OPEN+IDLE · Closed=CLOSED+ARCHIVED  
- [x] conversionRate decimal 0–1 · from/to · overdue ignora período  
- [x] Roles OWNER/ADMIN/AGENT  
- [x] Sem cache/frontend/gráficos  
- [x] `docs/dashboard-review.md`  
