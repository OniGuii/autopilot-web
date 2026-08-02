# Leads Review — Lead Management MVP

**Status:** Implementado  
**Branch:** `cursor/leads-implementation-dd93`  
**Base design:** `leads-design.md` (aprovado com decisões congeladas)

---

## 1. Arquitetura

```text
Cliente (Bearer JWT com cid/mid/role)
  │
  ├─ POST   /api/leads
  ├─ GET    /api/leads
  ├─ GET    /api/leads/:id
  ├─ PATCH  /api/leads/:id
  ├─ POST   /api/leads/:id/assign
  └─ DELETE /api/leads/:id
           │
           ▼
     LeadsController
       Guards: JwtAuthGuard → CompanyContextGuard → RolesGuard
       Roles: OWNER | ADMIN | AGENT
           │
           ▼
     LeadsService
       │  companyId = JWT.cid (nunca do body)
       │  phone = digits only
       │  soft delete via deletedAt
           │
           ├─ PrismaService.lead.*
           └─ AuditService.write(tx, …)  // mesma $transaction
```

Arquivos principais:

```text
src/modules/leads/
  leads.module.ts
  leads.controller.ts
  leads.service.ts
  dto/create-lead.dto.ts
  dto/update-lead.dto.ts
  dto/assign-lead.dto.ts
  dto/list-leads.query.dto.ts
  utils/normalize-phone.ts

src/modules/audit/audit.service.ts
src/modules/auth/guards/roles.guard.ts
src/modules/auth/decorators/roles.decorator.ts
```

Sem migration nova — usa tabelas `leads` e `audit_logs` existentes.  
Tenant Extension Prisma: **não** ativada.

---

## 2. Endpoints

| Método | Path | Status | Auth |
|---|---|---|---|
| `POST` | `/api/leads` | 201 | JWT + company + role |
| `GET` | `/api/leads` | 200 | JWT + company + role |
| `GET` | `/api/leads/:id` | 200 | JWT + company + role |
| `PATCH` | `/api/leads/:id` | 200 | JWT + company + role |
| `POST` | `/api/leads/:id/assign` | 200 | JWT + company + role |
| `DELETE` | `/api/leads/:id` | **204** | JWT + company + role |

### Decisões congeladas aplicadas

| Decisão | Implementação |
|---|---|
| DELETE 204 | `@HttpCode(NO_CONTENT)` |
| `companyId` na response | sempre em `LeadResponse` |
| phone dígitos | `normalizePhone()` + `@Transform` nos DTOs |
| audit na mesma tx | `$transaction` + `AuditService.write` |
| `ownerId` default null | omitido no create → `null` |
| sort `created_at DESC` | `orderBy: { createdAt: 'desc' }` |

---

## 3. Queries Prisma (resumo)

### Create
```ts
tx.lead.create({ data: { companyId: cid, name, phone: digits, ownerId?, … } })
tx.auditLog.create({ action: 'LEAD_CREATE', … })
```

### List
```ts
where: {
  companyId: cid,
  deletedAt: null,
  status?,
  ownerId? | ownerId: null (unassigned=true),
  OR: [{ name contains search }, { phone contains digits(search) }]
}
orderBy: createdAt desc
skip/take: page/limit
```

### Get / Update / Delete / Assign
Sempre `findFirst({ where: { id, companyId: cid, deletedAt: null } })` → 404 se ausente.

### Phone unique
Índice parcial `uq_leads_company_phone_active`; `P2002` → **409**.

---

## 4. Auditoria

| Ação API | `action` |
|---|---|
| POST create | `LEAD_CREATE` |
| PATCH update | `LEAD_UPDATE` |
| POST assign | `LEAD_ASSIGN` |
| DELETE soft | `LEAD_DELETE` |

Campos: `companyId=cid`, `actorType=USER`, `actorUserId=sub`, `targetType=LEAD`, `before`/`after` snapshot, `ip`/`userAgent`.

Falha de audit aborta a mutação (mesma transação).

---

## 5. Filtros e paginação

| Query | Comportamento |
|---|---|
| `status` | enum LeadStatus |
| `ownerId` | UUID exato |
| `unassigned=true` | `ownerId IS NULL` (conflito com `ownerId` → 400) |
| `search` | name ILIKE **ou** phone contains (digits) |
| `page` | default 1 |
| `limit` | default 20, max 100 |

Response list:

```json
{
  "data": [ /* Lead */ ],
  "meta": { "page": 1, "limit": 20, "total": 10, "totalPages": 1 }
}
```

---

## 6. Exemplos request/response

### Auth pré-requisito

```bash
# login → select-company → usar accessToken
```

### Create

```http
POST /api/leads
Authorization: Bearer <access>
Content-Type: application/json

{
  "name": "Maria Silva",
  "phone": "+55 (11) 98888-7777",
  "email": "maria@example.com",
  "status": "NEW"
}
```

```json
{
  "id": "...",
  "companyId": "...",
  "name": "Maria Silva",
  "phone": "5511988887777",
  "email": "maria@example.com",
  "source": "WHATSAPP",
  "status": "NEW",
  "score": 0,
  "ownerId": null,
  "externalId": null,
  "convertedAt": null,
  "firstResponseAt": null,
  "lastContactAt": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### List unassigned

```http
GET /api/leads?unassigned=true&page=1&limit=20
```

### Assign

```http
POST /api/leads/:id/assign
{ "ownerId": "<user-uuid-with-active-membership>" }
```

### Soft delete

```http
DELETE /api/leads/:id
→ 204 No Content
```

---

## 7. Segurança

- `companyId` do body rejeitado (`forbidNonWhitelisted`)
- Isolamento por `JWT.cid` em todas as queries
- Cross-tenant / deletado → **404**
- Roles: OWNER, ADMIN, AGENT
- `ownerId` validado contra Membership ACTIVE da company

---

## 8. Riscos

| Risco | Severidade | Nota |
|---|---|---|
| Seeds antigos com phone `+55…` vs novos só dígitos | Baixa | Search normaliza dígitos; novos creates são digits-only |
| Tenant Extension off | Aceito | Isolamento na app layer |
| AGENT pode CRUD qualquer lead da company | Aceito | RBAC fino fora do MVP |
| Sem rate-limit | Média | Gateway futuro |
| Nome ainda nullable no DB | Baixa | API exige no create |

---

## 9. Fora do escopo (confirmado)

Conversation, Message, WhatsApp, IA, Dashboard, Tenant Extension global.

---

## 10. Critérios de aceite

- [x] CRUD + assign
- [x] Multi-tenancy via JWT.cid
- [x] Soft delete → 204
- [x] Filtros + `unassigned` + search name/phone
- [x] Paginação + `created_at DESC`
- [x] Audit na mesma transação
- [x] Phone digits-only
- [x] ownerId default null
- [x] companyId nas responses
- [x] Roles OWNER/ADMIN/AGENT
- [x] `docs/leads-review.md`
