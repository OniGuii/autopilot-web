# Follow-Ups Review — Follow-Up Engine MVP

**Status:** Implementado  
**Branch:** `cursor/followups-implementation-dd93`  
**Base design:** `followups-design.md` (aprovado com decisões congeladas)

---

## 1. Arquitetura

```text
Cliente (Bearer JWT com cid/mid/role)
  │
  ├─ POST   /api/follow-ups
  ├─ GET    /api/follow-ups
  ├─ GET    /api/follow-ups/:id
  ├─ PATCH  /api/follow-ups/:id
  ├─ POST   /api/follow-ups/:id/approve
  ├─ POST   /api/follow-ups/:id/reject
  ├─ POST   /api/follow-ups/:id/reschedule
  └─ POST   /api/follow-ups/:id/execute
           │
           ▼
     FollowUpController  (@Controller('follow-ups'))
       Guards: JwtAuthGuard → CompanyContextGuard → RolesGuard
           │
           ▼
     FollowUpService
       │  companyId = JWT.cid
       │  Lead / Conversation validados na mesma company
           │
           ├─ Prisma FollowUp / Message / Conversation
           └─ AuditService.write(tx, …)
```

Sem migration nova. Sem WhatsApp. Tenant Extension off.

---

## 2. Fluxo de estados (implementado)

```text
SUGGESTED ──approve──► APPROVED ──reschedule──► SCHEDULED ──execute──► EXECUTED
    │
    └──reject──► REJECTED
```

| Ação | De | Para |
|---|---|---|
| create | — | `SUGGESTED` |
| approve | `SUGGESTED` | `APPROVED` |
| reject | `SUGGESTED` | `REJECTED` |
| reschedule | `APPROVED` \| `SCHEDULED` | `SCHEDULED` |
| execute | `APPROVED` \| `SCHEDULED` | `EXECUTED` |

Execute sem `conversationId` → **400**.  
Execute cria Message OUTBOUND (`senderUserId = JWT.sub`) e atualiza `Conversation.lastMessageAt`.

---

## 3. Endpoints

| Método | Path | Status |
|---|---|---|
| `POST` | `/api/follow-ups` | 201 |
| `GET` | `/api/follow-ups` | 200 |
| `GET` | `/api/follow-ups/:id` | 200 |
| `PATCH` | `/api/follow-ups/:id` | 200 |
| `POST` | `/api/follow-ups/:id/approve` | 200 |
| `POST` | `/api/follow-ups/:id/reject` | 200 |
| `POST` | `/api/follow-ups/:id/reschedule` | 200 |
| `POST` | `/api/follow-ups/:id/execute` | 200 |

### Filtros list

`status`, `leadId`, `assignedUserId`, `scheduledFrom`, `scheduledTo`, `overdue=true`, `page`, `limit`  
Ordenação: `scheduledAt ASC` (nulls last), `createdAt DESC`.

`overdue=true` ⇒ `scheduledAt < now` e status ∈ {`APPROVED`,`SCHEDULED`}.

---

## 4. Auditoria (mesma transação)

| Ação | `action` |
|---|---|
| create | `FOLLOWUP_CREATE` |
| patch | `FOLLOWUP_UPDATE` |
| approve | `FOLLOWUP_APPROVE` |
| reject | `FOLLOWUP_REJECT` |
| reschedule | `FOLLOWUP_RESCHEDULE` |
| execute | `FOLLOWUP_EXECUTE` (+ `MESSAGE_CREATE` da message gerada) |

---

## 5. Multi-tenancy

- `companyId` só de `JWT.cid`
- Body com `companyId` → 400
- Lead/Conversation cross-tenant → 404
- FollowUp sempre scoped por `cid + deletedAt null`
- Race double-execute: `updateMany` condicional → 409

---

## 6. Exemplos

### Create
```json
POST /api/follow-ups
{
  "leadId": "...",
  "conversationId": "...",
  "suggestedBody": "Oi! Ainda tem interesse?",
  "scheduledAt": "2026-08-01T10:00:00.000Z"
}
```

### Approve / Reject / Reschedule / Execute
```json
POST /api/follow-ups/:id/approve
{ "scheduledAt": "2026-08-03T15:00:00.000Z" }

POST /api/follow-ups/:id/reject
{ "reason": "Tom inadequado" }

POST /api/follow-ups/:id/reschedule
{ "scheduledAt": "2026-08-04T12:00:00.000Z" }

POST /api/follow-ups/:id/execute
```

### Overdue
```http
GET /api/follow-ups?overdue=true
```

---

## 7. WhatsApp futuro

Execute atual **não envia** WhatsApp — só persiste Message OUTBOUND.  
Futuro: `EXECUTING` → Evolution send → `EXECUTED` / `FAILED`.

---

## 8. Riscos

| Risco | Nota |
|---|---|
| Message “enviada” só localmente | UI deve distinguir registrado vs enviado |
| Estados EXECUTING/FAILED não usados | reservados |
| Tenant Extension off | isolamento app-layer |

---

## 9. Critérios de aceite

- [x] Endpoints create/list/get/patch/approve/reject/reschedule/execute  
- [x] APPROVE → APPROVED; reject reason obrigatório  
- [x] scheduledAt ASC; overdue filter  
- [x] PATCH → FOLLOWUP_UPDATE  
- [x] Execute Message OUTBOUND + lastMessageAt + audits  
- [x] Multi-tenancy JWT.cid  
- [x] `docs/followups-review.md`  
