# Leads Design — Lead Management MVP

**Status:** Aprovado → **implementado** (ver `leads-review.md`)  
**Fase:** 3 — Lead Management MVP  
**Pré-requisito:** Auth implementado (`auth-review.md`) — JWT com `cid` / `role` após `select-company`  
**Referências:** `domain-decisions.md` (D1, D2, D4, D6, D7, D10), `schema.prisma` (`Lead`, `AuditLog`), `tenant-safety.md`

### Decisões congeladas na aprovação

- DELETE = `204 No Content`
- `companyId` presente nas responses
- phone normalizado para **dígitos apenas**
- audit obrigatório na **mesma transação**
- `ownerId` padrão `null`
- ordenação padrão `created_at DESC`
- Extra: `POST /api/leads/:id/assign` + filtro `unassigned=true`

---

## 1. Objetivo

Entregar o primeiro módulo de negócio: CRUD de Leads com multi-tenancy seguro, soft delete, filtros/paginação e auditoria.

**Fora deste MVP (não implementar):**
- Conversation / Message  
- WhatsApp / Evolution  
- IA / Follow-Up  
- Dashboard / métricas  
- Importação em massa  
- Tags, notas, score automático  
- Ativação global da Prisma Tenant Extension  

---

## 2. Escopo de endpoints

Prefixo global existente: `api`.

| Método | Path | Auth | Descrição |
|---|---|---|---|
| `POST` | `/api/leads` | Bearer + company context | Criar lead |
| `GET` | `/api/leads` | Bearer + company context | Listar com filtros + paginação |
| `GET` | `/api/leads/:id` | Bearer + company context | Detalhe |
| `PATCH` | `/api/leads/:id` | Bearer + company context | Atualização parcial |
| `DELETE` | `/api/leads/:id` | Bearer + company context | Soft delete |

Guards obrigatórios em todos:
1. `JwtAuthGuard`
2. `CompanyContextGuard` (exige claims `mid`, `cid`, `role`)

Roles permitidas (D7): **`OWNER` | `ADMIN` | `AGENT`**  
No MVP Leads, as três roles têm o **mesmo** poder de CRUD (sem RBAC fino por ação).

---

## 3. Multi-tenancy

```text
companyId = JWT.cid   // única fonte de verdade
```

| Regra | Detalhe |
|---|---|
| Derivação | Todo create/list/get/update/delete usa `cid` do access token |
| Rejeição | Se o body/query trouxer `companyId` → **ignorar** (whitelist DTO) ou **400** (`forbidNonWhitelisted`) |
| Isolamento | `WHERE companyId = cid AND deletedAt IS NULL` em todas as queries |
| Cross-tenant | Lead de outra company → **404** (não 403), para não vazar existência |
| Extension | Tenant Extension Prisma permanece **desligada**; isolamento é na camada de serviço |

`ownerId` no create/update é opcional e, se informado, deve referenciar um `User` com Membership ACTIVE na mesma company (validação de servidor).

---

## 4. Modelo de dados (existente — sem migration nova)

Campos relevantes de `leads` (já no schema):

| Campo API | DB | Create | Update | Notas |
|---|---|---|---|---|
| — | `company_id` | server | imutável | de `JWT.cid` |
| `name` | `name` | **obrigatório** | opcional | API exige; schema Prisma ainda nullable |
| `phone` | `phone` | **obrigatório** | opcional | único por company (D6) |
| `email` | `email` | opcional | opcional | |
| `source` | `source` | opcional | opcional | default `WHATSAPP` |
| `status` | `status` | opcional | opcional | enum D1; default `NEW` |
| `ownerId` | `owner_id` | opcional | opcional | nullable; validar membership |
| `score` | `score` | opcional | opcional | 0–100; default 0 |
| `externalId` | `external_id` | opcional | opcional | |
| `metadata` | `metadata` | opcional | opcional | JSON livre |

Campos **somente leitura** na API MVP (não aceitos no write):
`id`, `companyId`, `lastContactAt`, `lastInboundAt`, `lastOutboundAt`, `convertedAt`, `firstResponseAt`, `createdAt`, `updatedAt`, `deletedAt`.

### Regras de status (D1/D2)

| Transição | Efeito colateral |
|---|---|
| status → `CONVERTED` | setar `convertedAt = now()` **somente se ainda null** |
| status sai de `CONVERTED` | **não** limpar `convertedAt` (regra de domínio já documentada) |
| demais status | sem side-effect de timestamps de canal (isso virá com WhatsApp/Conversation) |

---

## 5. Validações

| Campo | Regra |
|---|---|
| `name` | string, trim, min 1, max 200 — **obrigatório no create** |
| `phone` | string, trim, min 3, max 32 — **obrigatório no create** |
| `email` | email válido se presente; max 320 |
| `status` | enum: `NEW\|CONTACTED\|RESPONDED\|QUALIFIED\|CONVERTED\|LOST` |
| `score` | int 0–100 |
| `ownerId` | UUID; se presente, membership ACTIVE na company do JWT |
| `source` | string max 32 |
| `companyId` | **proibido** no body |

### Unicidade de telefone (D6)

Índice parcial já existe: `uq_leads_company_phone_active` em `(company_id, phone) WHERE deleted_at IS NULL`.

- Create/update com phone duplicado (ativo) → **409 Conflict**  
  mensagem: `Lead with this phone already exists`
- Soft-deleted não bloqueia reutilização do mesmo phone

Normalização MVP (proposta mínima):
- trim
- **sem** reformatação E.164 agressiva nesta fase (aceitar o valor enviado após trim)
- opcional documentado: rejeitar espaços internos (`/^\+?[0-9()\-\s]+$/` ou similar) — a confirmar na aprovação

---

## 6. Filtros e busca — `GET /api/leads`

### Query params

| Param | Tipo | Default | Descrição |
|---|---|---|---|
| `status` | LeadStatus | — | filtro exato |
| `ownerId` | UUID | — | filtro exato; `null` **não** suportado no MVP (só UUID) |
| `search` | string | — | busca em `name` **ou** `phone` (contains, case-insensitive) |
| `page` | int ≥ 1 | `1` | página |
| `limit` | int 1–100 | `20` | page size (cap 100) |

Sempre aplicados pelo servidor:
- `companyId = JWT.cid`
- `deletedAt = null`
- ordenação default: `createdAt desc`

### Semântica de `search`

```text
OR [
  name  contains search (insensitive),
  phone contains search (insensitive)
]
```

Não busca em `email` neste MVP (escopo explícito: name + phone).

---

## 7. Paginação — response shape

```json
{
  "data": [ /* Lead[] */ ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 123,
    "totalPages": 7
  }
}
```

`total` = count com os mesmos filtros (exclui soft-deleted).

### Item Lead (response)

```json
{
  "id": "...",
  "name": "Maria Silva",
  "phone": "+5511999990001",
  "email": null,
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

`companyId` pode ser omitido na response (já implícito no contexto) ou incluído para debug — **proposta:** incluir `companyId` somente se útil ao client; default **incluir** (transparência, sem risco porque já autenticado no tenant).

---

## 8. Contratos por endpoint

### `POST /api/leads`

**Request**
```json
{
  "name": "Maria Silva",
  "phone": "+5511999990001",
  "email": "maria@example.com",
  "source": "WHATSAPP",
  "status": "NEW",
  "ownerId": null,
  "score": 0
}
```

**Response:** `201` + Lead criado  
**Erros:** `400` validação · `401/403` auth/context · `409` phone duplicado

### `GET /api/leads`

**Request:** query (`status`, `ownerId`, `search`, `page`, `limit`)  
**Response:** `200` + `{ data, meta }`

### `GET /api/leads/:id`

**Response:** `200` + Lead · `404` se inexistente / outra company / soft-deleted

### `PATCH /api/leads/:id`

**Request (parcial)**
```json
{
  "name": "Maria S.",
  "status": "CONTACTED",
  "ownerId": "..."
}
```

**Response:** `200` + Lead atualizado  
**Erros:** `404` · `409` phone · `400` validação

### `DELETE /api/leads/:id`

- Soft delete: `deletedAt = now()`
- **Não** hard delete
- Idempotência: segundo delete no mesmo id → `404` (já não listável)  
**Response:** `204` (sem body) **ou** `200 { ok: true }` — **proposta:** `204 No Content`

---

## 9. Auditoria

Criar `AuditLog` em toda mutação bem-sucedida:

| Ação API | `action` | `before` | `after` |
|---|---|---|---|
| CREATE | `LEAD_CREATE` | `null` | snapshot do lead |
| UPDATE | `LEAD_UPDATE` | snapshot anterior | snapshot novo |
| DELETE | `LEAD_DELETE` | snapshot anterior | `{ deletedAt }` |

Campos fixos:
- `companyId` = `JWT.cid`
- `actorType` = `USER`
- `actorUserId` = `JWT.sub`
- `targetType` = `LEAD`
- `targetId` = lead id
- `ip` / `userAgent` do request (quando disponíveis)
- `occurredAt` = now

Snapshot mínimo (evitar JSON enorme):
`id, name, phone, email, source, status, score, ownerId, deletedAt, convertedAt`

Auditoria falha → **proposta:** falha da operação inteira (transação única create/update/delete + audit). Mais seguro para compliance MVP.

`GET` **não** gera AuditLog.

---

## 10. Soft delete

| Operação | Comportamento |
|---|---|
| DELETE | seta `deleted_at`; registro permanece |
| GET list/detail | exclui `deletedAt != null` |
| PATCH | só em leads ativos |
| Unicidade phone | partial unique ignora deletados |

Prisma Soft-Delete Extension global: **não ativar**; filtro explícito no service.

---

## 11. Arquitetura de implementação (após aprovação)

```text
modules/leads/
  leads.module.ts
  leads.controller.ts
  leads.service.ts
  dto/
    create-lead.dto.ts
    update-lead.dto.ts
    list-leads.query.dto.ts
  (opcional) leads.mapper.ts

shared/ ou modules/audit/
  audit.service.ts   // helper createAuditLog — reutilizável
```

Fluxo:

```text
Controller
  → JwtAuthGuard + CompanyContextGuard
  → DTO validation (ValidationPipe global)
  → LeadsService(cid, sub, role, dto)
       → Prisma Lead (sempre scoped por cid)
       → AuditLog (mesma transaction)
```

Sem nova migration de schema (tabelas já existem).  
Possível única alteração futura: tornar `name` `NOT NULL` no DB — **fora** desta fase (API valida; DB permanece nullable por compatibilidade com seeds antigos / imports).

---

## 12. Segurança

| Controle | Como |
|---|---|
| Autenticação | Bearer JWT |
| Contexto tenant | `CompanyContextGuard` |
| Autorização role | role ∈ {OWNER, ADMIN, AGENT}; sem role → 403 |
| companyId spoofing | DTO whitelist; never trust body |
| IDOR cross-tenant | query sempre com `companyId + id` → 404 |
| Mass assignment | `forbidNonWhitelisted` nos DTOs |

---

## 13. Riscos

| Risco | Severidade | Mitigação / gap |
|---|---|---|
| Esquecer filtro `companyId` em algum método | Alta | Helper interno `leadWhere(cid)` obrigatório; review checklist |
| Tenant Extension off | Aceito | Isolamento só na app layer — risco até ativação futura |
| Phone sem normalização E.164 | Média | Duplicatas “iguais” com formatação diferente; evoluir depois |
| `name` nullable no DB vs obrigatório na API | Baixa | Validação de API; migration NOT NULL opcional futura |
| AGENT altera/deleta qualquer lead da company | Aceito no MVP | RBAC fino (só próprios) fora de escopo |
| Audit em transação aumenta latência | Baixa | Aceitável no volume MVP |
| Race create duplicado phone | Baixa | Unique parcial + catch P2002 → 409 |
| Soft delete sem cascade conversas | Aceito | Conversas ainda não expostas; limpeza futura |

---

## 14. Exemplos de erro

| Caso | HTTP |
|---|---|
| Sem token / token inválido | 401 |
| Sem select-company (`cid` ausente) | 403 |
| Role inválida (não deve ocorrer com Membership) | 403 |
| Validação DTO | 400 |
| Phone duplicado | 409 |
| Lead não encontrado / outra company / deletado | 404 |

---

## 15. Critérios de aceite (para a implementação futura)

- [ ] 5 endpoints CRUD sob `/api/leads`
- [ ] `companyId` sempre do JWT; nunca do cliente
- [ ] Soft delete via `deleted_at`
- [ ] Filtros `status`, `ownerId`, `search`, `page`, `limit`
- [ ] `search` em `name` e `phone`
- [ ] AuditLog CREATE / UPDATE / DELETE
- [ ] `name` + `phone` obrigatórios no create
- [ ] Roles OWNER / ADMIN / AGENT
- [ ] Sem Conversation / Message / WhatsApp / IA / Dashboard
- [ ] Doc de review pós-implementação (`leads-review.md`)

---

## 16. Decisões pedindo aprovação explícita

1. **Response DELETE:** `204 No Content` (recomendado) vs `200 { ok: true }`  
2. **Incluir `companyId` na response do Lead?** Sim (recomendado) vs omitir  
3. **Normalização de phone:** só trim (recomendado MVP) vs E.164 estrito  
4. **Audit em transação com a mutação?** Sim (recomendado) vs best-effort  
5. **`ownerId` default no create:** `null` (recomendado) vs `JWT.sub` automático  

---

## 17. Próximo passo

**Aguardar aprovação** deste design (e das decisões §16).  
Somente após aprovação explícita → implementar código + testes manuais + `docs/leads-review.md`.
