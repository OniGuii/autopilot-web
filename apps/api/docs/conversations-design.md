# Conversations Design — Conversations & Messages MVP

**Status:** Aprovado → **implementado** (ver `conversations-review.md`)  
**Fase:** 4 — Conversations MVP  
**Pré-requisitos:** Auth (`auth-review.md`) + Leads (`leads-review.md`)  
**Referências:** `domain-decisions.md` (D7, D9, D10), `domain-model.md` (§5.5–5.6), `schema.prisma` (`Conversation`, `Message`, `AuditLog`), `leads-design.md`

### Decisões congeladas na aprovação

- Ordenação listagem: `lastMessageAt DESC` (nulls last) + `createdAt DESC`
- Múltiplas conversations por lead **permitidas**
- GET `:id` retorna últimas **50** messages (ordem cronológica na response)
- Query/campo oficial: **`assignedUserId`**
- Audit `body` truncado em **2000** chars
- `companyId` presente nas responses
- Extra: `senderUserId` opcional em Message; `POST /conversations/:id/close`
- Direção: `INBOUND` = cliente→empresa; `OUTBOUND` = empresa→cliente

---

## 1. Objetivo

Expor o histórico de relacionamento do Lead via **Conversation** (thread) e **Message** (unidades da thread), com multi-tenancy seguro e auditoria.

**Fora deste MVP (não implementar):**
- WhatsApp / Evolution / webhooks  
- IA / geração de respostas  
- Follow-up automático  
- Dashboard  
- DELETE de Conversation/Message  
- Ativação global da Prisma Tenant Extension  

---

## 2. Entidades

```text
Company
  └── Lead
        └── Conversation  (aggregate root)
              └── Message   (sempre dentro da Conversation)
```

| Entidade | Pertence a | Notas |
|---|---|---|
| Conversation | Company + Lead | `company_id` denormalizado + `lead_id` |
| Message | Conversation (+ Company denormalizado) | Nunca órfã (D9) |

### 2.1 Conversation (schema existente)

| Campo | DB | Create | Update | Notas |
|---|---|---|---|---|
| — | `company_id` | server | imutável | `JWT.cid` |
| `leadId` | `lead_id` | **obrigatório** | imutável | Lead ativo da mesma company |
| `channel` | `channel` | opcional | opcional | default `WHATSAPP` (único canal MVP) |
| `status` | `status` | opcional | opcional | `OPEN\|IDLE\|CLOSED\|ARCHIVED`; default `OPEN` |
| `assignedUserId` | `assigned_user_id` | opcional | opcional | Membership ACTIVE; default `null` |
| `externalThreadId` | `external_thread_id` | opcional | opcional | reservado WhatsApp; sem integração nesta fase |
| — | `last_message_at` | server | server | atualizado ao criar Message |
| — | `created_at` / `updated_at` / `deleted_at` | server | — | soft delete ainda não exposto via DELETE |

### 2.2 Message (schema existente)

| Campo API | DB | Create | Notas |
|---|---|---|---|
| `direction` | `direction` | **obrigatório** | `INBOUND` \| `OUTBOUND` |
| `body` | `body` | **obrigatório** | texto; trim; min 1 |
| — | `company_id` | server | = conversation.companyId (= JWT.cid) |
| — | `conversation_id` | server | path `:id` |
| — | `status` | server | ver defaults §6 |
| — | `content_type` | server | default `TEXT` |
| — | `sender_type` | server | ver defaults §6 |
| — | `sender_user_id` | server | `JWT.sub` se OUTBOUND; `null` se INBOUND |
| — | `sent_at` | server | `now()` no create MVP |

Campos **não aceitos** no body do cliente nesta fase: `companyId`, `conversationId`, `status`, `senderType`, `senderUserId`, `externalMessageId`, timestamps de delivery/read, `metadata`.

---

## 3. Endpoints

Prefixo global: `api`.

| Método | Path | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/conversations` | Bearer + company + role | Listar com filtros + paginação |
| `GET` | `/api/conversations/:id` | Bearer + company + role | Detalhe (+ lead resumo + messages recentes) |
| `POST` | `/api/conversations` | Bearer + company + role | Criar conversation |
| `PATCH` | `/api/conversations/:id` | Bearer + company + role | Atualizar status / assignee / etc. |
| `POST` | `/api/conversations/:id/messages` | Bearer + company + role | Criar message na conversation |

Guards (mesmo padrão Leads):
1. `JwtAuthGuard`
2. `CompanyContextGuard`
3. `RolesGuard` → **`OWNER` \| `ADMIN` \| `AGENT`**

Sem RBAC fino por ação no MVP.

**Não há** `DELETE` nem listagem standalone `/api/messages` nesta fase.

---

## 4. Multi-tenancy

```text
companyId = JWT.cid   // única fonte de verdade
```

| Regra | Detalhe |
|---|---|
| Derivação | Todo create/list/get/update usa `cid` |
| Body/query | `companyId` do cliente → **400** (`forbidNonWhitelisted`) |
| Isolation | `WHERE companyId = cid AND deletedAt IS NULL` |
| Cross-tenant | recurso de outra company / soft-deleted → **404** |
| Extension | Tenant Extension **desligada**; isolamento no service |

---

## 5. Proteção cross-tenant (crítico)

### 5.1 Create Conversation

```text
1. companyId := JWT.cid
2. Buscar Lead: id = leadId AND companyId = cid AND deletedAt IS NULL
   → se não achar: 404 Lead not found
3. Garantia explícita: lead.companyId === cid
4. Criar Conversation com companyId = cid, leadId = lead.id
```

Nunca confiar em `leadId` sem validar company.  
Bloquear qualquer tentativa de anexar Lead de outro tenant.

### 5.2 Create Message

```text
1. Buscar Conversation: id = :id AND companyId = cid AND deletedAt IS NULL
   → 404 se ausente
2. Message.companyId := conversation.companyId  (igual a cid)
3. Message.conversationId := conversation.id
4. Atualizar conversation.lastMessageAt := now()
```

Message **sempre** herda company da Conversation (não do body).

### 5.3 Get / Patch Conversation

Sempre scoped por `{ id, companyId: cid, deletedAt: null }`.

---

## 6. Defaults de Message (servidor)

| `direction` | `status` | `senderType` | `senderUserId` |
|---|---|---|---|
| `INBOUND` | `RECEIVED` | `LEAD` | `null` |
| `OUTBOUND` | `SENT` | `USER` | `JWT.sub` |

Também no create:
- `contentType = TEXT`
- `sentAt = now()`
- `body` trimado, não vazio

Side-effect obrigatório na **mesma transação**:
- `Conversation.lastMessageAt = now()`

**Não** atualizar nesta fase: `Lead.lastContactAt` / inbound / outbound (pode ser fase futura alinhada a WhatsApp).

---

## 7. Contratos por endpoint

### `POST /api/conversations`

**Request**
```json
{
  "leadId": "<uuid>",
  "channel": "WHATSAPP",
  "status": "OPEN",
  "assignedUserId": null,
  "externalThreadId": null
}
```

**Response:** `201` + Conversation (com `companyId`)

**Erros:** `400` validação · `404` lead · `401/403` auth

### `GET /api/conversations`

Query:

| Param | Tipo | Default | Descrição |
|---|---|---|---|
| `status` | ConversationStatus | — | filtro exato |
| `leadId` | UUID | — | filtro exato |
| `assignedId` | UUID | — | mapeia para `assignedUserId` |
| `search` | string | — | `lead.name` **ou** `lead.phone` (contains, insensitive; phone via dígitos) |
| `page` | int ≥ 1 | `1` | |
| `limit` | int 1–100 | `20` | |

Sempre: `companyId = cid`, `deletedAt = null`.  
Ordenação proposta: `lastMessageAt DESC NULLS LAST`, fallback `createdAt DESC`  
(**decidir na aprovação** — ver §14).

**Response**
```json
{
  "data": [
    {
      "id": "...",
      "companyId": "...",
      "leadId": "...",
      "channel": "WHATSAPP",
      "status": "OPEN",
      "assignedUserId": null,
      "externalThreadId": null,
      "lastMessageAt": null,
      "createdAt": "...",
      "updatedAt": "...",
      "lead": {
        "id": "...",
        "name": "Maria Silva",
        "phone": "5511988887777"
      }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### `GET /api/conversations/:id`

**Response:** Conversation + `lead` resumo + `messages` recentes (proposta: últimas **50**, order `createdAt ASC`).

Sem endpoint separado de listagem de messages nesta fase.

### `PATCH /api/conversations/:id`

Campos mutáveis:
- `status`
- `assignedUserId` (UUID \| `null`; se UUID → Membership ACTIVE)
- `externalThreadId` (opcional)
- `channel` (opcional; só `WHATSAPP` no MVP)

`leadId` / `companyId` **imutáveis**.

**Response:** `200` + Conversation atualizada

### `POST /api/conversations/:id/messages`

**Request**
```json
{
  "direction": "OUTBOUND",
  "body": "Olá! Ainda tem interesse?"
}
```

**Response:** `201` + Message (com `companyId`, `conversationId`)

**Erros:** `404` conversation · `400` body/direction

---

## 8. Auditoria

Mesma transação da mutação (padrão Leads).

| Ação API | `action` | `targetType` | before / after |
|---|---|---|---|
| POST conversation | `CONVERSATION_CREATE` | `CONVERSATION` | null / snapshot |
| PATCH conversation | `CONVERSATION_UPDATE` | `CONVERSATION` | before / after |
| POST message | `MESSAGE_CREATE` | `MESSAGE` | null / snapshot |

Campos fixos:
- `companyId = JWT.cid`
- `actorType = USER`
- `actorUserId = JWT.sub`
- `ip` / `userAgent` quando disponíveis

Snapshot Conversation: `id, companyId, leadId, channel, status, assignedUserId, externalThreadId, lastMessageAt, deletedAt`  
Snapshot Message: `id, companyId, conversationId, direction, status, body, senderType, senderUserId, sentAt`

`GET` não audita.

---

## 9. Soft delete

- List/get/patch/message-create só em Conversation com `deletedAt = null`
- Message create não exige soft-delete API; messages de conversation deletada ficam inacessíveis via API
- **Sem** endpoint DELETE nesta fase

---

## 10. Arquitetura proposta (após aprovação)

```text
modules/conversations/
  conversations.module.ts
  conversations.controller.ts
  conversations.service.ts
  dto/
    create-conversation.dto.ts
    update-conversation.dto.ts
    list-conversations.query.dto.ts
    create-message.dto.ts

Reusa:
  AuditService.write(tx, …)
  JwtAuthGuard + CompanyContextGuard + RolesGuard
```

Messages ficam **no mesmo controller/service** (sub-recurso), sem `MessagesModule` separado no MVP.

```text
POST /conversations
  → validate Lead(companyId=cid)
  → tx: create Conversation + CONVERSATION_CREATE

POST /conversations/:id/messages
  → load Conversation(companyId=cid)
  → tx: create Message + update lastMessageAt + MESSAGE_CREATE
```

Sem migration nova (tabelas já existem).

---

## 11. Segurança

| Controle | Como |
|---|---|
| AuthN | Bearer JWT |
| Tenant | `CompanyContextGuard` + `cid` em toda query |
| Roles | OWNER / ADMIN / AGENT |
| Mass assignment | DTO whitelist; `companyId` proibido |
| IDOR | 404 cross-tenant |
| Lead hijack | Lead sempre revalidado por `companyId` |
| Message orphan | só via conversation scoped |

---

## 12. Riscos

| Risco | Severidade | Mitigação / gap |
|---|---|---|
| Esquecer filtro `companyId` | Alta | helper `conversationWhere(cid)`; checklist review |
| Lead de outro tenant no create | Alta | validate Lead antes do create; 404 |
| Múltiplas conversations por Lead+canal | Média | domínio sugere 1 ativa; MVP **permite N** até regra de unicidade (decisão §14) |
| Messages sem list pagination própria | Baixa | detalhe limita a 50; evoluir depois |
| INBOUND manual sem WhatsApp | Aceito | útil para seed/demo; canal real vem depois |
| Não atualizar timestamps do Lead | Baixa | fase WhatsApp/engagement |
| Tenant Extension off | Aceito | isolamento app-layer |
| Body grande em audit snapshot | Baixa | truncar body no audit se > N chars (proposta: 2k) |

---

## 13. Exemplos de erro

| Caso | HTTP |
|---|---|
| Sem token / inválido | 401 |
| Sem company context | 403 |
| Role insuficiente | 403 |
| Validação DTO / `companyId` no body | 400 |
| Lead/Conversation outra company ou deletado | 404 |
| `assignedUserId` sem membership ACTIVE | 400 |

---

## 14. Decisões pedindo aprovação explícita

1. **Ordenação da listagem:** `lastMessageAt DESC NULLS LAST, createdAt DESC` (**recomendado**) vs só `createdAt DESC`  
2. **Múltiplas conversations por Lead+canal:** permitir N (**recomendado MVP**) vs bloquear segunda `OPEN` no mesmo canal  
3. **GET `:id` inclui messages?** últimas 50 ASC (**recomendado**) vs conversation pura sem messages  
4. **Filtro `assignedId`:** nome do query param `assignedId` (pedido) mapeando `assignedUserId` — confirmar  
5. **Audit de message:** truncar `body` em 2000 chars no snapshot (**recomendado**) vs body completo  
6. **`companyId` nas responses** de Conversation e Message: sim (**recomendado**, alinhado a Leads)

---

## 15. Critérios de aceite (implementação futura)

- [ ] Endpoints Conversation list/get/create/patch  
- [ ] `POST /conversations/:id/messages`  
- [ ] `companyId` sempre do JWT; nunca do client  
- [ ] Create valida Lead da mesma company  
- [ ] Message atualiza `last_message_at`  
- [ ] Audit `CONVERSATION_CREATE|UPDATE` + `MESSAGE_CREATE` na mesma tx  
- [ ] Filtros `status`, `leadId`, `assignedId`, `search` (lead name/phone)  
- [ ] Roles OWNER/ADMIN/AGENT  
- [ ] Sem WhatsApp / IA / Follow-up / Dashboard  
- [ ] `docs/conversations-review.md` pós-implementação  

---

## 16. Próximo passo

**Aguardar aprovação** deste design (e das decisões §14).  
Somente após aprovação explícita → implementar código + testes locais + `docs/conversations-review.md`.
