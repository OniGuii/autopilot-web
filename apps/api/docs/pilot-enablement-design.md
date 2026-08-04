# Fase 10 — Pilot Enablement (Design)

**Status:** Design — aguardando aprovação  
**Escopo:** preparar a API Autopilot para piloto real (settings, equipe, admin de usuário, diagnostics, setup wizard, audit V2, exportações CSV)  
**Fora de escopo (não alterar):** WhatsApp Engine, AI Engine, Workers, Dashboard, CRM Operations (Notes/Activities/Timeline/Pipeline), RLS infrastructure, frontend, deploy  
**Sem novas funcionalidades de negócio** (sem novos estágios de lead, sem SLA runtime, sem tags/custom fields, sem campanhas)  
**Referências:** `domain-model.md`, `domain-decisions.md` (D7/D8/D10), `access-hardening` (AuthRevocationService), `ops` (`GET /api/ops/health`, `GET /api/ops/audit`), `crm-operations-review.md`

---

## 1. Objetivo

Habilitar um piloto controlado com usuários reais: configurar a empresa, gerir membros e sessões, diagnosticar dependências, guiar o setup inicial, explorar auditoria e exportar dados operacionais — **sem** expandir o domínio comercial nem tocar nos engines.

Princípios:

| Princípio | Regra |
|---|---|
| Enablement, não produto novo | Só APIs de administração / operação / onboarding / export |
| Tenant | `companyId = JWT.cid` apenas; DTOs nunca aceitam `companyId` do cliente |
| Roles | `OWNER \| ADMIN \| AGENT` (D7); mutações sensíveis → `OWNER\|ADMIN` |
| Fail-closed | User `ACTIVE`, Membership `ACTIVE`, Company `ACTIVE` (já enforced) |
| Revogação | Reusar `AuthRevocationService` (hooks existentes; sem reinventar sessão) |
| RLS | **Não** alterar helpers/policies genéricas; só ADD se surgir tabela tenant nova |
| Engines | Diagnostics / wizard **leem** status; não mudam WhatsApp/AI/Workers/Dashboard/CRM |
| Frontend | Não nesta fase |

---

## 2. Decisões de design (propostas)

| ID | Decisão | Proposta |
|---|---|---|
| P1 | Company Settings fields | `name`, `slug`, `timezone` já existem em `Company`. Adicionar `locale`, `businessHours` (JSON), `logoUrl`. `status`/`plan` **fora** do PATCH de settings do piloto. |
| P2 | Path settings | `GET/PATCH /api/settings/company` (módulo `settings` ou `companies` fill-scaffold). Escopo = company do JWT. |
| P3 | Add member | `POST /api/memberships` com `{ email, name?, role }`. Se User não existe → cria `User` (`PENDING` ou `ACTIVE` se password temporária — ver P3a). Cria `Membership` `INVITED` (default schema) ou `ACTIVE` + `joinedAt` se piloto optar por ativação imediata. |
| P3a | Ativação imediata vs invite | **Default piloto:** criar User `ACTIVE` com `passwordHash` gerado (retorno one-shot `temporaryPassword`) **ou** User `PENDING` sem login até set-password. **Proposta recomendada:** `ACTIVE` + temporary password one-shot no response (piloto sem e-mail). Alternativa: só `INVITED` sem password (requer fluxo set-password futuro). |
| P4 | Remove member | Soft: `Membership.status = REVOKED` + `deletedAt` + `AuthRevocationService.onMembershipRevoked`. **Proibido** remover o último `OWNER` ACTIVE. |
| P5 | Change role | `PATCH /api/memberships/:id` `{ role }`. Não permitir rebaixar/remover último OWNER. AGENT não muda roles. |
| P6 | Disable user | `POST /api/users/:id/disable` → `User.status = DISABLED` + `onUserDisabled` (logout-all). `POST …/enable` → `ACTIVE`. Escopo: user deve ter membership na company atual (não admin global). |
| P7 | Logout-all remoto | `POST /api/users/:id/logout-all` (OWNER\|ADMIN) → revoga sessões do user (mesmo serviço que `auth/logout-all`). |
| P8 | Sessões ativas | `GET /api/users/:id/sessions` lista `Session` não revogadas / não expiradas do user **com `companyId = JWT.cid`** (ou membership da company). Sem tokens/secrets no payload. |
| P9 | Diagnostics | Novo `GET /api/ops/diagnostics` — agrega checks: Postgres, Redis, WhatsApp (company), Workers (filas Bull já em `ops/health`), OpenAI (probe leve). **Não** substitui `/health*` públicos nem altera engines. Pode reutilizar lógica interna de `getHealth` + check OpenAI novo. |
| P10 | OpenAI check | `ok \| degraded \| error \| skipped`. `skipped` se API key ausente / stub. Probe: timeout curto (ex. 2s), sem custo alto (ex. models list ou no-op configurável). Não altera AI Engine de sugestões. |
| P11 | Setup Wizard | API de **estado** `GET /api/setup/status` + passo bootstrap `POST /api/setup/company` (criar empresa + membership OWNER do ator). Passos WA/lead/mensagem **reusam** endpoints existentes (`/whatsapp/connect`, `/leads`, send). Sem UI. |
| P12 | Audit Explorer V2 | Evoluir `GET /api/ops/audit` (já tem `action`, `actorUserId`, `targetType`, `from`, `to`). V2: aliases/docs (`entity`→`targetType`), filtro `action` prefix/contains opcional, `q` opcional, default limit maior documentado, response com labels. Path permanece sob `/api/ops/audit` (ou alias `/api/audit` preenchendo scaffold vazio). |
| P13 | Export CSV | `GET /api/exports/leads`, `/activities`, `/followups` — stream `text/csv`, OWNER\|ADMIN, filtros de período/status, **hard cap** de linhas (ex. 10_000). Soft-deleted excluídos. |
| P14 | Migrations | Uma migration settings (`locale`, `businessHours`, `logoUrl` + indexes/uniques se necessário). **Sem** novas tabelas de membership/session/audit. Wizard/export/diagnostics = código only. |
| P15 | Slug | Unique parcial entre companies não deletadas (se ainda não enforced). PATCH slug → 409 se conflito. |

---

## 3. Company Settings

### 3.1 Estado atual

`Company` já tem: `id`, `name`, `slug?`, `status`, `timezone` (default `America/Sao_Paulo`), `plan?`, timestamps, soft-delete.  
**Não existem** `locale`, `businessHours`, `logoUrl`.  
`CompaniesController` é scaffold vazio. `GET /api/auth/me` devolve só `{ id, name, slug }` da company.

### 3.2 Migration (pós-aprovação)

```sql
ALTER TABLE "companies"
  ADD COLUMN "locale" VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN "business_hours" JSONB,
  ADD COLUMN "logo_url" VARCHAR(500);

-- opcional: unique parcial de slug onde deleted_at IS NULL (se ainda não existir)
```

Prisma:

| Campo | Tipo | Notas |
|---|---|---|
| `locale` | `String` `@db.VarChar(16)` default `"pt-BR"` | BCP-47 curto |
| `businessHours` | `Json?` `@map("business_hours")` | ver shape §3.4 |
| `logoUrl` | `String?` `@map("logo_url")` `@db.VarChar(500)` | URL https |

**Não** muda RLS (Company é modelo global; isolamento via JWT.cid nas queries).

### 3.3 Endpoints

```http
GET   /api/settings/company
PATCH /api/settings/company
```

Guards: `JwtAuthGuard` + `CompanyContextGuard` + `RolesGuard`.  
- GET: `OWNER|ADMIN|AGENT`  
- PATCH: `OWNER|ADMIN`

### 3.4 Contratos

**GET response**

```json
{
  "id": "uuid",
  "name": "Acme",
  "slug": "acme",
  "timezone": "America/Sao_Paulo",
  "locale": "pt-BR",
  "businessHours": {
    "timezone": "America/Sao_Paulo",
    "weekly": {
      "mon": [{ "start": "09:00", "end": "18:00" }],
      "tue": [{ "start": "09:00", "end": "18:00" }],
      "wed": [{ "start": "09:00", "end": "18:00" }],
      "thu": [{ "start": "09:00", "end": "18:00" }],
      "fri": [{ "start": "09:00", "end": "18:00" }],
      "sat": [],
      "sun": []
    }
  },
  "logoUrl": null,
  "updatedAt": "ISO-8601"
}
```

**PATCH body** (todos opcionais; partial update)

| Campo | Validação |
|---|---|
| `name` | 1–200 chars |
| `slug` | 2–100, `[a-z0-9-]+`, unique entre ativas |
| `timezone` | IANA válida (whitelist ou lib) |
| `locale` | ex. `pt-BR`, `en-US` |
| `businessHours` | objeto JSON schema §3.4; `null` limpa |
| `logoUrl` | URL https ≤500 ou `null` |

**Fora do PATCH:** `status`, `plan`, `id`, `deletedAt`.

Auditoria: `COMPANY_SETTINGS_UPDATE` (`targetType=Company`, before/after dos campos alterados).

---

## 4. Membership Management

### 4.1 Estado atual

Modelo `Membership` completo (`role`, `status` string `INVITED|ACTIVE|REVOKED`, `invitedBy`, `joinedAt`).  
APIs HTTP de list/add/remove/role: **inexistentes** (seed only).  
`AuthRevocationService.onMembershipRevoked` pronto.

### 4.2 Endpoints

| Método | Path | Roles | Descrição |
|---|---|---|---|
| `GET` | `/api/memberships` | OWNER\|ADMIN\|AGENT | Lista memberships da company (não REVOKED/soft-deleted por default) |
| `POST` | `/api/memberships` | OWNER\|ADMIN | Add/invite membro |
| `PATCH` | `/api/memberships/:id` | OWNER\|ADMIN | Alterar `role` |
| `DELETE` | `/api/memberships/:id` | OWNER\|ADMIN | Revogar (soft) |

Query list (opcional): `role`, `status`, `page`, `limit` (default 50, max 100).

### 4.3 Add member — body

```json
{
  "email": "agent@acme.com",
  "name": "Ana Agent",
  "role": "AGENT"
}
```

Fluxo (P3a recomendado — ativação piloto):

1. Lookup User por email (global).  
2. Se não existe → create User `ACTIVE` + password temporária.  
3. Se Membership ACTIVE já existe na company → **409**.  
4. Se Membership REVOKED/soft → reativar (`ACTIVE`, role novo, clear `deletedAt`) **ou** criar nova row (preferir reativar a mesma unique lógica).  
5. `invitedBy = JWT.sub`, `joinedAt = now()` se ACTIVE.  
6. Response inclui `temporaryPassword` **somente** na criação de user novo (one-shot; nunca em listagens).  
7. Audit: `MEMBERSHIP_CREATE` (+ `USER_CREATE` se aplicável).

### 4.4 Regras

- Não revogar / rebaixar o **último OWNER ACTIVE**.  
- OWNER pode criar outro OWNER; AGENT nunca.  
- Admin não altera membership de outra company (404).  
- Revogação → `onMembershipRevoked` (sessions/refresh da membership).  
- Soft-delete membership alinhado a tenant extension (Membership já tenant-scoped).

### 4.5 Response item

```json
{
  "id": "uuid",
  "userId": "uuid",
  "email": "…",
  "name": "…",
  "role": "AGENT",
  "status": "ACTIVE",
  "joinedAt": "…",
  "createdAt": "…"
}
```

---

## 5. User Administration

### 5.1 Estado atual

`User.status`: `PENDING | ACTIVE | DISABLED`.  
`POST /api/auth/logout-all` existe para o próprio ator.  
Listagem de sessões: **não**.  
`onUserDisabled` existe.

### 5.2 Endpoints

| Método | Path | Roles | Descrição |
|---|---|---|---|
| `POST` | `/api/users/:id/disable` | OWNER\|ADMIN | `DISABLED` + logout-all |
| `POST` | `/api/users/:id/enable` | OWNER\|ADMIN | `ACTIVE` |
| `POST` | `/api/users/:id/logout-all` | OWNER\|ADMIN | Revoga todas as sessions do user |
| `GET` | `/api/users/:id/sessions` | OWNER\|ADMIN | Sessões ativas (company-scoped) |

Pré-condição: target user **tem** membership (qualquer status recente / ACTIVE) na `JWT.cid`. Caso contrário → **404** (não vazar users globais).

### 5.3 Disable regras

- Não desativar a si mesmo se for o último OWNER ACTIVE da company (ou bloquear self-disable de OWNER único).  
- Disable **não** apaga User (global); só status + revogação.  
- Memberships ACTIVE permanecem; acesso falha por fail-closed User.status. Opcional documentado: também revogar memberships da company (proposta: **não** — disable é global no user; piloto deve preferir revoke membership para corte tenant-local).  
  - **Decisão aberta P6b:** disable = global vs “suspend membership only”. **Recomendação piloto:** preferir `DELETE /memberships/:id` para corte local; `disable` reserved para OWNER quando user não deve logar em **nenhuma** company (uso raro). Alternativa mais segura: na Fase 10 **não** expor disable global — só revoke membership + logout-all remoto. Ver §16.

### 5.4 Sessions response

```json
{
  "items": [
    {
      "id": "uuid",
      "createdAt": "…",
      "expiresAt": "…",
      "ip": "…",
      "userAgent": "…",
      "membershipId": "…",
      "current": false
    }
  ]
}
```

Sem refresh token hashes. Filtro: `revokedAt IS NULL AND expiresAt > now() AND deletedAt IS NULL` e (`companyId = cid` OR membership da company).

Auditoria: `USER_DISABLE`, `USER_ENABLE`, `USER_LOGOUT_ALL` (actor = admin).

---

## 6. Operational Diagnostics

### 6.1 Estado atual

- Públicos: `/health`, `/health/live`, `/health/ready` (Postgres+Redis), `/metrics`  
- Tenant: `GET /api/ops/health` — postgres, redis, whatsapp, queues Bull, evolution circuit  
- **Falta:** probe OpenAI dedicado; endpoint nomeado `diagnostics`

### 6.2 Endpoint

```http
GET /api/ops/diagnostics
```

Roles: `OWNER|ADMIN` (AGENT opcional read-only — **proposta:** OWNER\|ADMIN only; secrets/ops surface).

### 6.3 Checks

| Check | Fonte | Não altera |
|---|---|---|
| `postgres` | `SELECT 1` (igual ready/health) | — |
| `redis` | PING | — |
| `whatsapp` | status da instance da company (read) | WhatsApp Engine |
| `workers` | snapshot filas já usado em `ops/health` (`available`, depths, DLQ) | Workers |
| `openai` | probe leve / skipped | AI Engine |

Response shape (proposta):

```json
{
  "status": "ok | degraded | error",
  "checks": {
    "postgres": { "status": "ok", "latencyMs": 3 },
    "redis": { "status": "ok", "latencyMs": 1 },
    "whatsapp": { "status": "ok | degraded | error", "detail": "…" },
    "workers": { "status": "ok | degraded | error", "queues": { "…": {} } },
    "openai": { "status": "ok | degraded | error | skipped", "latencyMs": 120 }
  },
  "timestamp": "ISO-8601"
}
```

Implementação: extrair helpers privados compartilhados com `getHealth` **sem** mudar contrato de `/api/ops/health` (manter compat). Diagnostics = superfície piloto mais clara + OpenAI.

---

## 7. Setup Wizard

### 7.1 Objetivo

Checklist de prontidão para piloto — **orquestra leitura** + um bootstrap mínimo. Não reimplementa WhatsApp connect nem CRM.

### 7.2 Endpoints

| Método | Path | Roles | Descrição |
|---|---|---|---|
| `GET` | `/api/setup/status` | autenticado (com ou sem cid — ver abaixo) | Estado dos passos |
| `POST` | `/api/setup/company` | autenticado **sem** exigir company context (ou OWNER bootstrap) | Cria company + membership OWNER |

**Passos lógicos**

| Step | `key` | Done when | Ação do cliente (endpoints existentes) |
|---|---|---|---|
| 1 | `company` | User tem ≥1 membership ACTIVE | `POST /api/setup/company` |
| 2 | `whatsapp` | Instance connected / ready para a company | `POST /api/whatsapp/connect` + `GET /api/whatsapp/status` |
| 3 | `firstLead` | `Lead` count ≥ 1 na company | `POST /api/leads` |
| 4 | `firstMessage` | ≥1 `Message` outbound ou inbound na company | send existente / inbound webhook |

### 7.3 `GET /api/setup/status`

Com `cid` no JWT (pós `select-company`):

```json
{
  "steps": [
    { "key": "company", "done": true },
    { "key": "whatsapp", "done": false, "detail": "NO_INSTANCE" },
    { "key": "firstLead", "done": false },
    { "key": "firstMessage", "done": false }
  ],
  "complete": false
}
```

Sem `cid`: só reporta step `company` (memberships do user).

### 7.4 `POST /api/setup/company`

Body: `{ "name", "slug?", "timezone?", "locale?" }`  
- Cria `Company` ACTIVE + settings defaults  
- Cria `Membership` OWNER ACTIVE para `JWT.sub`  
- Audit `COMPANY_CREATE`, `MEMBERSHIP_CREATE`  
- Response: company + hint para `POST /api/auth/select-company`  
- Se user já é OWNER de N companies: permitido (multi-tenant); rate-limit / max companies por user (ex. 3) no piloto — **P11b** default max 3

**Não** chama Evolution/AI/Workers.

---

## 8. Audit Explorer V2

### 8.1 Estado atual

`GET /api/ops/audit` e `GET /api/ops/audit/:id` já filtram:

- `action`, `actorUserId`, `targetType`, `targetId`, `from`, `to`, `page`, `limit`

### 8.2 Evolução V2 (sem breaking)

| Melhoria | Detalhe |
|---|---|
| Alias `entity` | Query `entity` aceito como alias de `targetType` (usuário pediu “entidade”) |
| Alias `userId` | Alias de `actorUserId` |
| Período | Manter `from`/`to`; documentar timezone = UTC; opcional `preset` fora de v1 |
| Ação | Suportar match exato (atual) + opcional `actionPrefix` (ex. `LEAD_`) |
| Detail | List continua sem `before`/`after`; `GET :id` completo |
| Scaffold | Opcional: `GET /api/audit` → delegate ao mesmo service (não duplicar lógica) |

Roles: manter `OWNER|ADMIN|AGENT` read (igual hoje) **ou** restringir AGENT — **proposta:** manter três roles read-only.

Índices existentes (`companyId+occurredAt`, `companyId+action`, `actorUserId`) suficientes; sem migration obrigatória.

---

## 9. Exportações CSV

### 9.1 Endpoints

| Método | Path | Roles |
|---|---|---|
| `GET` | `/api/exports/leads` | OWNER\|ADMIN |
| `GET` | `/api/exports/activities` | OWNER\|ADMIN |
| `GET` | `/api/exports/followups` | OWNER\|ADMIN |

`Content-Type: text/csv; charset=utf-8`  
`Content-Disposition: attachment; filename="leads-<slug>-<date>.csv"`

### 9.2 Query comum

| Param | Descrição |
|---|---|
| `from` / `to` | filtro por `createdAt` (UTC) |
| `status` | opcional (lead/activity/followup status) |
| `limit` | soft max default 10_000 (hard cap) |

### 9.3 Colunas (v1)

**leads:** `id,name,phone,email,status,source,ownerId,score,createdAt,updatedAt,convertedAt,firstResponseAt`  

**activities:** `id,leadId,type,status,title,userId,scheduledAt,completedAt,createdAt`  

**followups:** `id,leadId,status,type,channel,assignedUserId,scheduledAt,executedAt,createdAt`

Sem `metadata` JSON completo na v1 (evita CSV explosivo). Soft-deleted excluídos. Tenant = JWT.cid.

Auditoria: `EXPORT_LEADS` / `EXPORT_ACTIVITIES` / `EXPORT_FOLLOWUPS` (after: `{ rowCount, from, to }`).

---

## 10. Regras transversais

| Tema | Regra |
|---|---|
| Tenant | Sempre `JWT.cid`; 404 cross-tenant |
| Auth guards | Jwt + CompanyContext (exceto `POST /setup/company` e talvez `GET /setup/status` parcial) |
| Audit | Mutações na mesma TX que `AuditService.write` |
| Soft delete | Listagens padrão excluem `deletedAt` |
| Passwords | Temporary password só no create response; hash argon/bcrypt existente |
| Rate limits | Setup company + exports: limites conservadores |
| Engines | Read-only diagnostics; zero mudança de contratos send/AI/workers |
| Domínio principal | Sem alteração de enums Lead/Message/FollowUp/Conversation |
| RLS | Sem mudança de helpers; Company/User/Session globais; Membership já RLS’d |
| Frontend | Não |

---

## 11. Migrations necessárias (pós-aprovação)

1. **`2026xxxxxx_pilot_company_settings`**  
   - `companies.locale` (default `pt-BR`)  
   - `companies.business_hours` (JSONB nullable)  
   - `companies.logo_url` (varchar nullable)  
   - Unique parcial `slug` se ainda não existir  

2. **Nenhuma** tabela nova para memberships, sessions, audit, exports, diagnostics, wizard.

Seed: opcional popular `locale`/`businessHours` em profile `demo` (não bloquear CI).

---

## 12. Endpoints — mapa completo

| Método | Path | Novelty |
|---|---|---|
| `GET` | `/api/settings/company` | novo |
| `PATCH` | `/api/settings/company` | novo |
| `GET` | `/api/memberships` | novo |
| `POST` | `/api/memberships` | novo |
| `PATCH` | `/api/memberships/:id` | novo |
| `DELETE` | `/api/memberships/:id` | novo |
| `POST` | `/api/users/:id/disable` | novo (decisão P6b) |
| `POST` | `/api/users/:id/enable` | novo (decisão P6b) |
| `POST` | `/api/users/:id/logout-all` | novo |
| `GET` | `/api/users/:id/sessions` | novo |
| `GET` | `/api/ops/diagnostics` | novo |
| `GET` | `/api/setup/status` | novo |
| `POST` | `/api/setup/company` | novo |
| `GET` | `/api/ops/audit` | **existente** — V2 filtros |
| `GET` | `/api/ops/audit/:id` | **existente** |
| `GET` | `/api/audit` | opcional alias → mesmo service |
| `GET` | `/api/exports/leads` | novo |
| `GET` | `/api/exports/activities` | novo |
| `GET` | `/api/exports/followups` | novo |

**Reuso sem alteração de contrato:** `/api/whatsapp/*`, `/api/leads`, send message, `/api/ops/health`, `/api/auth/*`.

---

## 13. Impacto operacional

| Área | Impacto |
|---|---|
| Piloto | OWNER configura company, convida agentes, valida health, completa wizard, exporta CSV |
| Suporte | Diagnostics + sessions + logout-all remoto reduzem tempo de troubleshooting |
| Segurança | Revogação membership/user centralizada; exports auditados; temporary passwords one-shot |
| Performance | Exports com hard cap; diagnostics com timeouts curtos; audit usa índices existentes |
| Engines | Nenhum — só leitura de status/filas |
| CRM / Dashboard | Nenhum |
| Ops existentes | `/ops/health` permanece; diagnostics é superfície adicional |
| Dados | 3 colunas novas em `companies`; sem backfill crítico |

---

## 14. Riscos

| Risco | Mitigação |
|---|---|
| Disable User é **global** e afeta outras companies | Decisão P6b: preferir revoke membership no piloto; disable só com warning / ou adiar |
| Temporary password em logs/CI | Nunca logar password; só response JSON; e2e usa fixture |
| Último OWNER removido/desativado | Guards explícitos + testes |
| Export grande derruba API | Hard cap 10k + stream + timeout; OWNER\|ADMIN only |
| OpenAI probe custo/latência | Timeout 2s; skipped sem key; cache curto opcional (30s) |
| `POST /setup/company` abuso | Max companies/user; auth required; rate limit |
| Confusão diagnostics vs `/ops/health` | Docs: health = produto atual; diagnostics = checklist piloto + openai |
| Scope creep (e-mail invite, SSO, billing) | Explicitamente fora (§15) |
| Alteração acidental de engines | PR checklist: diff não toca whatsapp/ai/workers/dashboard/crm/rls cores |

---

## 15. Ordem recomendada de implementação

```text
10.1  Migration company settings + GET/PATCH /api/settings/company
10.2  Memberships CRUD (list/add/patch role/revoke) + AuthRevocation wire + testes
10.3  User admin: sessions list + logout-all remoto (+ disable/enable se P6b aprovado)
10.4  GET /api/ops/diagnostics (+ OpenAI probe skipped-safe)
10.5  Setup wizard: POST /setup/company + GET /setup/status
10.6  Audit Explorer V2 (aliases entity/userId + actionPrefix; alias /api/audit opcional)
10.7  Exports CSV leads / activities / followups
10.8  E2E smoke piloto (settings → member → diagnostics → setup status → export)
```

Cada subfase: unit + e2e smoke + lint/build; **sem** frontend; **sem** alterar engines/CRM/RLS cores.

---

## 16. Fora desta fase (explícito)

- Implementação de código antes da aprovação deste design  
- Frontend / UI / e-mail transacional de invite  
- Alterações WhatsApp Engine, AI Engine, Workers, Dashboard, CRM Operations, RLS helpers  
- Novas features de negócio (SLA runtime, tags, custom pipelines, billing, SSO)  
- Mudança de contratos sync de send/AI  
- Import CSV  
- Admin superuser cross-tenant  

---

## 17. Critérios de aprovação do design

- [ ] Confirmar **P1** campos settings (`locale`, `businessHours`, `logoUrl`) e exclusão de `plan`/`status` do PATCH  
- [ ] Confirmar **P3a** (temporary password vs INVITED-only)  
- [ ] Confirmar **P6b** (disable user global vs só membership revoke no piloto)  
- [ ] Confirmar roles de **diagnostics** (OWNER\|ADMIN vs +AGENT)  
- [ ] Confirmar **P11b** max companies por user no setup  
- [ ] Confirmar hard cap de export (10_000) e colunas CSV  
- [ ] Confirmar Audit V2 permanece em `/api/ops/audit` (+ alias opcional)  

**Após aprovação:** implementar na ordem §15 — sem iniciar frontend nem alterar engines.

---

## 18. Resumo executivo

### Migrations necessárias

| # | Mudança |
|---|---|
| 1 | `companies`: `locale`, `business_hours`, `logo_url` (+ unique parcial `slug` se faltar) |
| — | Sem tabelas novas |

### Endpoints (novos / evoluidos)

- **Settings:** `GET/PATCH /api/settings/company`  
- **Memberships:** `GET/POST /api/memberships`, `PATCH/DELETE /api/memberships/:id`  
- **Users:** `POST …/disable|enable`, `POST …/logout-all`, `GET …/sessions`  
- **Ops:** `GET /api/ops/diagnostics`  
- **Setup:** `GET /api/setup/status`, `POST /api/setup/company`  
- **Audit V2:** evoluir `GET /api/ops/audit` (aliases filtros)  
- **Exports:** `GET /api/exports/{leads,activities,followups}`  

### Impacto operacional

Piloto consegue autoatender configuração, equipe, diagnóstico e exportação sem mudar engines nem CRM. Suporte ganha logout-all remoto e sessions. Superfície de risco principal = admin de users/memberships e exports.

### Riscos

Disable global cross-company; abuse de setup/export; probe OpenAI; perda do último OWNER — mitigados por decisões P6b/P11b, caps e guards.

### Ordem recomendada

Settings → Memberships → User admin → Diagnostics → Setup → Audit V2 → Exports → E2E smoke.

**Aguardando aprovação antes de escrever código.**
