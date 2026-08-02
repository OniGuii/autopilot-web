# Conversations Review — Conversations & Messages MVP

**Status:** Implementado  
**Branch:** `cursor/conversations-implementation-dd93`  
**Base design:** `conversations-design.md` (aprovado com decisões congeladas)

---

## 1. Arquitetura

```text
Cliente (Bearer JWT com cid/mid/role)
  │
  ├─ POST   /api/conversations
  ├─ GET    /api/conversations
  ├─ GET    /api/conversations/:id
  ├─ PATCH  /api/conversations/:id
  ├─ POST   /api/conversations/:id/close
  └─ POST   /api/conversations/:id/messages
           │
           ▼
     ConversationsController
       Guards: JwtAuthGuard → CompanyContextGuard → RolesGuard
       Roles: OWNER | ADMIN | AGENT
           │
           ▼
     ConversationsService
       │  companyId = JWT.cid
       │  Lead validado na mesma company (create)
       │  Message herda company da Conversation
           │
           ├─ Prisma Conversation / Message / Lead
           └─ AuditService.write(tx, …)  // mesma $transaction
```

Arquivos:

```text
src/modules/conversations/
  conversations.module.ts
  conversations.controller.ts
  conversations.service.ts
  dto/create-conversation.dto.ts
  dto/update-conversation.dto.ts
  dto/list-conversations.query.dto.ts
  dto/create-message.dto.ts
```

Sem migration nova. Tenant Extension: **não** ativada.

---

## 2. Endpoints

| Método | Path | Status | Descrição |
|---|---|---|---|
| `POST` | `/api/conversations` | 201 | Cria thread para Lead da company |
| `GET` | `/api/conversations` | 200 | Lista + filtros; `lastMessageAt DESC` |
| `GET` | `/api/conversations/:id` | 200 | Detalhe + lead + últimas 50 messages |
| `PATCH` | `/api/conversations/:id` | 200 | Atualiza status/assignee/channel/externalThreadId |
| `POST` | `/api/conversations/:id/close` | 200 | `status = CLOSED` (+ audit `CONVERSATION_CLOSE`) |
| `POST` | `/api/conversations/:id/messages` | 201 | Cria message; atualiza `lastMessageAt` |

---

## 3. Direção de Message

| Direction | Significado | Defaults servidor |
|---|---|---|
| `INBOUND` | cliente → empresa | `status=RECEIVED`, `senderType=LEAD`, `senderUserId=null` |
| `OUTBOUND` | empresa → cliente | `status=SENT`, `senderType=USER`, `senderUserId=JWT.sub` (ou override opcional) |

`senderUserId` opcional:
- **OUTBOUND:** default `JWT.sub`; se informado, deve ser Membership ACTIVE
- **INBOUND:** proibido (400 se enviado)

---

## 4. Multi-tenancy & cross-tenant

| Operação | Proteção |
|---|---|
| Create conversation | Lead `id + companyId=cid + deletedAt null`; rejeita lead de outro tenant (404) |
| List/get/patch/close | `conversation.companyId = cid` |
| Create message | Conversation scoped por cid; `message.companyId = conversation.companyId` |
| Body `companyId` | rejeitado (DTO whitelist / forbidNonWhitelisted) |

Múltiplas conversations por lead: **permitidas**.

---

## 5. Queries (resumo)

### List
```ts
where: { companyId: cid, deletedAt: null, status?, leadId?, assignedUserId?,
         lead: { OR: [name contains, phone contains] } }
orderBy: [ lastMessageAt desc nulls last, createdAt desc ]
```

### Get
```ts
conversation + lead
messages: last 50 by createdAt desc → reversed to ASC in response
```

### Message create (tx)
```ts
message.create(...)
conversation.update({ lastMessageAt: now })
audit MESSAGE_CREATE
```

---

## 6. Auditoria

| Ação | `action` |
|---|---|
| Create conversation | `CONVERSATION_CREATE` |
| Patch conversation | `CONVERSATION_UPDATE` |
| Close conversation | `CONVERSATION_CLOSE` |
| Create message | `MESSAGE_CREATE` |

- Mesma `$transaction` da mutação  
- Snapshot de message: `body` truncado em **2000** chars  

---

## 7. Exemplos

### Create conversation
```json
POST /api/conversations
{ "leadId": "<uuid>" }
```

### Create outbound message
```json
POST /api/conversations/:id/messages
{ "direction": "OUTBOUND", "body": "Olá! Ainda tem interesse?" }
```

### Create inbound message
```json
POST /api/conversations/:id/messages
{ "direction": "INBOUND", "body": "Sim, quero saber o preço." }
```

### Close
```http
POST /api/conversations/:id/close
→ { "status": "CLOSED", "companyId": "...", ... }
```

### List filters
```http
GET /api/conversations?status=OPEN&leadId=...&assignedUserId=...&search=Maria
```

---

## 8. Riscos

| Risco | Severidade | Nota |
|---|---|---|
| Tenant Extension off | Aceito | isolamento app-layer |
| N conversations por lead | Aceito | decisão congelada |
| Messages além de 50 no GET | Baixa | sem paginação dedicada ainda |
| INBOUND manual sem WhatsApp | Aceito | demo/histórico |
| Lead timestamps não atualizados | Baixa | fase WhatsApp |

---

## 9. Fora do escopo (confirmado)

WhatsApp, IA, Follow-up automático, Dashboard, DELETE.

---

## 10. Critérios de aceite

- [x] Endpoints conversation + messages + close  
- [x] Multi-tenancy JWT.cid + proteção Lead/Conversation  
- [x] Message atualiza `lastMessageAt`  
- [x] Audit na mesma tx (body ≤ 2000)  
- [x] Filtros status/leadId/assignedUserId/search  
- [x] Ordenação lastMessageAt DESC  
- [x] GET com 50 messages  
- [x] senderUserId opcional  
- [x] companyId nas responses  
- [x] `docs/conversations-review.md`  
