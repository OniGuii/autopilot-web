# Modelo Relacional — AutoPilot MVP

**Status:** Proposta para aprovação (sem `schema.prisma` / migrations)  
**Base:** `domain-model.md` + `domain-decisions.md`  
**SGBD:** PostgreSQL  
**ORM alvo (futuro):** Prisma

Este documento define o modelo relacional completo do MVP.  
**Não criar schema Prisma nem migrations até aprovação explícita.**

---

## 1. Convenções globais

| Convenção | Valor |
|---|---|
| Naming tabelas | `snake_case`, plural |
| Naming colunas | `snake_case` |
| PK | `id UUID` |
| Timestamps | `created_at`, `updated_at` (`TIMESTAMPTZ`) |
| Soft delete | `deleted_at TIMESTAMPTZ NULL` — **nunca hard delete** |
| Tenant | `company_id UUID NOT NULL` em entidades de negócio |
| Exceção tenant | `users` (global) |
| Enums | armazenar como `TEXT` + check, ou enum PG; valores em **UPPER_SNAKE** alinhados ao domínio |
| JSON | `JSONB` |
| Telefone | E.164 (`+5511999999999`) |

### Soft delete e unicidade

Constraints de unicidade de negócio usam índice único **parcial**:

```sql
WHERE deleted_at IS NULL
```

Assim, um registro soft-deleted não bloqueia recriação.

### Multi-tenancy

- Toda query de negócio filtra por `company_id`
- FKs para entidades tenant devem respeitar a mesma Company (enforce no app; opcionalmente defensivo no DB)

---

## 2. Enums do MVP

### `company_status`
`ACTIVE` | `SUSPENDED` | `CLOSED`

### `user_status`
`PENDING` | `ACTIVE` | `DISABLED`

### `membership_status`
`INVITED` | `ACTIVE` | `REVOKED`

### `membership_role` (D7)
`OWNER` | `ADMIN` | `AGENT`

### `lead_status` (D1)
`NEW` | `CONTACTED` | `RESPONDED` | `QUALIFIED` | `CONVERTED` | `LOST`

### `lead_source`
`WHATSAPP` | `MANUAL` | `IMPORT` | `OTHER`

### `conversation_status`
`OPEN` | `IDLE` | `CLOSED` | `ARCHIVED`

### `channel`
`WHATSAPP` *(único canal no MVP)*

### `message_direction`
`INBOUND` | `OUTBOUND`

### `message_status`
`PENDING` | `SENT` | `DELIVERED` | `READ` | `FAILED` | `RECEIVED`

### `message_content_type`
`TEXT` | `IMAGE` | `AUDIO` | `DOCUMENT` | `OTHER`

### `message_sender_type`
`LEAD` | `USER` | `SYSTEM` | `AI`

### `follow_up_status` (D3 híbrido)
`SUGGESTED` | `APPROVED` | `REJECTED` | `SCHEDULED` | `EXECUTING` | `EXECUTED` | `FAILED` | `CANCELLED` | `SKIPPED`

### `follow_up_type`
`REMINDER` | `RECOVERY` | `NURTURE`

### `event_status`
`PENDING` | `PROCESSED` | `FAILED`

### `audit_actor_type`
`USER` | `SYSTEM` | `AI`

---

## 3. Tabelas

### 3.1 `companies`

| Coluna | Tipo | Null | Default | Descrição |
|---|---|---|---|---|
| `id` | UUID | NO | gen | PK |
| `name` | VARCHAR(200) | NO | | Nome comercial |
| `slug` | VARCHAR(100) | YES | | Identificador amigável |
| `status` | TEXT | NO | `'ACTIVE'` | `company_status` |
| `timezone` | VARCHAR(64) | NO | `'America/Sao_Paulo'` | |
| `plan` | VARCHAR(32) | YES | `'starter'` | reservado; billing futuro |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | |
| `deleted_at` | TIMESTAMPTZ | YES | | soft delete |

**Constraints**
- PK (`id`)
- UNIQUE parcial (`slug`) WHERE `slug IS NOT NULL AND deleted_at IS NULL`

**Indexes**
- `idx_companies_status` (`status`) WHERE `deleted_at IS NULL`

**Multi-tenancy:** é a raiz do tenant.  
**Soft delete:** sim.

---

### 3.2 `users`

| Coluna | Tipo | Null | Default | Descrição |
|---|---|---|---|---|
| `id` | UUID | NO | gen | PK |
| `email` | VARCHAR(320) | NO | | único global |
| `name` | VARCHAR(200) | NO | | |
| `password_hash` | VARCHAR(255) | YES | | auth local (se aplicável) |
| `status` | TEXT | NO | `'PENDING'` | `user_status` |
| `last_login_at` | TIMESTAMPTZ | YES | | |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | |
| `deleted_at` | TIMESTAMPTZ | YES | | soft delete |

**Constraints**
- PK (`id`)
- UNIQUE parcial (`email`) WHERE `deleted_at IS NULL`

**Indexes**
- `idx_users_status` (`status`) WHERE `deleted_at IS NULL`

**Multi-tenancy:** **não** possui `company_id` (D10).  
**Soft delete:** sim.

---

### 3.3 `memberships`

| Coluna | Tipo | Null | Default | Descrição |
|---|---|---|---|---|
| `id` | UUID | NO | gen | PK |
| `company_id` | UUID | NO | | FK → companies |
| `user_id` | UUID | NO | | FK → users |
| `role` | TEXT | NO | | `OWNER` \| `ADMIN` \| `AGENT` |
| `status` | TEXT | NO | `'INVITED'` | membership_status |
| `invited_by` | UUID | YES | | FK → users |
| `joined_at` | TIMESTAMPTZ | YES | | |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | |
| `deleted_at` | TIMESTAMPTZ | YES | | soft delete |

**Constraints**
- PK (`id`)
- FK `company_id` → `companies(id)`
- FK `user_id` → `users(id)`
- FK `invited_by` → `users(id)`
- UNIQUE parcial (`company_id`, `user_id`) WHERE `deleted_at IS NULL`
- CHECK `role IN ('OWNER','ADMIN','AGENT')`

**Indexes**
- `idx_memberships_company` (`company_id`) WHERE `deleted_at IS NULL`
- `idx_memberships_user` (`user_id`) WHERE `deleted_at IS NULL`
- `idx_memberships_company_role` (`company_id`, `role`) WHERE `deleted_at IS NULL`

**Multi-tenancy:** sim (`company_id`).  
**Soft delete:** sim.  
**Notas:** vínculo obrigatório User↔Company (D8).

---

### 3.4 `leads`

| Coluna | Tipo | Null | Default | Descrição |
|---|---|---|---|---|
| `id` | UUID | NO | gen | PK |
| `company_id` | UUID | NO | | FK tenant |
| `owner_id` | UUID | YES | | FK → users (responsável) |
| `name` | VARCHAR(200) | YES | | |
| `phone` | VARCHAR(32) | NO | | E.164; único na company |
| `email` | VARCHAR(320) | YES | | |
| `source` | TEXT | NO | `'WHATSAPP'` | lead_source |
| `status` | TEXT | NO | `'NEW'` | D1 |
| `score` | INTEGER | NO | `0` | 0–100 (D4) |
| `last_contact_at` | TIMESTAMPTZ | YES | | |
| `last_inbound_at` | TIMESTAMPTZ | YES | | |
| `last_outbound_at` | TIMESTAMPTZ | YES | | |
| `external_id` | VARCHAR(191) | YES | | id canal |
| `metadata` | JSONB | YES | | |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | |
| `deleted_at` | TIMESTAMPTZ | YES | | soft delete |

**Constraints**
- PK (`id`)
- FK `company_id` → `companies(id)`
- FK `owner_id` → `users(id)`
- UNIQUE parcial (`company_id`, `phone`) WHERE `deleted_at IS NULL` **(D6)**
- CHECK `status IN ('NEW','CONTACTED','RESPONDED','QUALIFIED','CONVERTED','LOST')`
- CHECK `score >= 0 AND score <= 100`

**Indexes**
- `idx_leads_company_status` (`company_id`, `status`) WHERE `deleted_at IS NULL`
- `idx_leads_company_owner` (`company_id`, `owner_id`) WHERE `deleted_at IS NULL`
- `idx_leads_company_last_contact` (`company_id`, `last_contact_at`) WHERE `deleted_at IS NULL`
- `idx_leads_company_score` (`company_id`, `score`) WHERE `deleted_at IS NULL`

**Multi-tenancy:** sim.  
**Soft delete:** sim.

---

### 3.5 `conversations`

| Coluna | Tipo | Null | Default | Descrição |
|---|---|---|---|---|
| `id` | UUID | NO | gen | PK |
| `company_id` | UUID | NO | | FK tenant |
| `lead_id` | UUID | NO | | FK → leads |
| `channel` | TEXT | NO | `'WHATSAPP'` | canal |
| `status` | TEXT | NO | `'OPEN'` | conversation_status |
| `external_thread_id` | VARCHAR(191) | YES | | Evolution/WhatsApp |
| `last_message_at` | TIMESTAMPTZ | YES | | |
| `assigned_user_id` | UUID | YES | | FK → users |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | |
| `deleted_at` | TIMESTAMPTZ | YES | | soft delete |

**Constraints**
- PK (`id`)
- FK `company_id` → `companies(id)`
- FK `lead_id` → `leads(id)`
- FK `assigned_user_id` → `users(id)`
- UNIQUE parcial (`company_id`, `channel`, `external_thread_id`) WHERE `external_thread_id IS NOT NULL AND deleted_at IS NULL`
- CHECK `channel IN ('WHATSAPP')` *(MVP)*

**Indexes**
- `idx_conversations_company_lead` (`company_id`, `lead_id`) WHERE `deleted_at IS NULL`
- `idx_conversations_company_status` (`company_id`, `status`) WHERE `deleted_at IS NULL`
- `idx_conversations_company_last_message` (`company_id`, `last_message_at`) WHERE `deleted_at IS NULL`

**Multi-tenancy:** sim.  
**Soft delete:** sim.  
**Regra:** aggregate root de Messages (D9).

---

### 3.6 `messages`

| Coluna | Tipo | Null | Default | Descrição |
|---|---|---|---|---|
| `id` | UUID | NO | gen | PK |
| `company_id` | UUID | NO | | FK tenant (desnormalizado) |
| `conversation_id` | UUID | NO | | FK → conversations **obrigatória** |
| `direction` | TEXT | NO | | INBOUND / OUTBOUND |
| `status` | TEXT | NO | | message_status |
| `body` | TEXT | YES | | texto / caption |
| `content_type` | TEXT | NO | `'TEXT'` | |
| `sender_type` | TEXT | NO | | LEAD/USER/SYSTEM/AI |
| `sender_user_id` | UUID | YES | | FK → users |
| `external_message_id` | VARCHAR(191) | YES | | idempotência canal |
| `sent_at` | TIMESTAMPTZ | YES | | |
| `delivered_at` | TIMESTAMPTZ | YES | | |
| `read_at` | TIMESTAMPTZ | YES | | |
| `metadata` | JSONB | YES | | payload canal |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | |
| `deleted_at` | TIMESTAMPTZ | YES | | soft delete |

**Constraints**
- PK (`id`)
- FK `company_id` → `companies(id)`
- FK `conversation_id` → `conversations(id)` **ON DELETE RESTRICT**
- FK `sender_user_id` → `users(id)`
- UNIQUE parcial (`company_id`, `external_message_id`) WHERE `external_message_id IS NOT NULL AND deleted_at IS NULL`
- CHECK `conversation_id IS NOT NULL` (implícito NOT NULL — D9)

**Indexes**
- `idx_messages_conversation_created` (`conversation_id`, `created_at`)
- `idx_messages_company_created` (`company_id`, `created_at`) WHERE `deleted_at IS NULL`
- `idx_messages_company_status` (`company_id`, `status`) WHERE `deleted_at IS NULL`

**Multi-tenancy:** sim.  
**Soft delete:** sim.  
**Regra crítica (D9):** não existe message sem `conversation_id`.

---

### 3.7 `follow_ups`

| Coluna | Tipo | Null | Default | Descrição |
|---|---|---|---|---|
| `id` | UUID | NO | gen | PK |
| `company_id` | UUID | NO | | FK tenant |
| `lead_id` | UUID | NO | | FK → leads |
| `conversation_id` | UUID | YES | | FK → conversations |
| `assigned_user_id` | UUID | YES | | FK → users |
| `approved_by` | UUID | YES | | FK → users (D3) |
| `approved_at` | TIMESTAMPTZ | YES | | |
| `channel` | TEXT | NO | `'WHATSAPP'` | |
| `status` | TEXT | NO | `'SUGGESTED'` | follow_up_status |
| `type` | TEXT | NO | `'RECOVERY'` | follow_up_type |
| `scheduled_at` | TIMESTAMPTZ | YES | | |
| `executed_at` | TIMESTAMPTZ | YES | | |
| `suggested_body` | TEXT | YES | | texto sugerido |
| `result_message_id` | UUID | YES | | FK → messages |
| `cancel_reason` | VARCHAR(500) | YES | | |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | |
| `deleted_at` | TIMESTAMPTZ | YES | | soft delete |

**Constraints**
- PK (`id`)
- FK `company_id` → `companies(id)`
- FK `lead_id` → `leads(id)`
- FK `conversation_id` → `conversations(id)`
- FK `assigned_user_id` → `users(id)`
- FK `approved_by` → `users(id)`
- FK `result_message_id` → `messages(id)`
- CHECK status ∈ enum híbrido (D3)
- CHECK: envio (`EXECUTED`) implica `approved_by IS NOT NULL` *(enforce preferencialmente na aplicação no MVP)*

**Indexes**
- `idx_follow_ups_company_status` (`company_id`, `status`) WHERE `deleted_at IS NULL`
- `idx_follow_ups_company_scheduled` (`company_id`, `scheduled_at`) WHERE `deleted_at IS NULL`
- `idx_follow_ups_lead` (`company_id`, `lead_id`) WHERE `deleted_at IS NULL`

**Multi-tenancy:** sim.  
**Soft delete:** sim.  
**Fora do MVP:** tabela `recovery_campaigns` (D5).

---

### 3.8 `events`

| Coluna | Tipo | Null | Default | Descrição |
|---|---|---|---|---|
| `id` | UUID | NO | gen | PK |
| `company_id` | UUID | YES | | FK tenant (null só se global) |
| `type` | VARCHAR(120) | NO | | ex.: `message.received` |
| `aggregate_type` | VARCHAR(64) | NO | | `lead`, `conversation`, … |
| `aggregate_id` | UUID | NO | | |
| `payload` | JSONB | NO | `'{}'` | |
| `actor_user_id` | UUID | YES | | FK → users |
| `correlation_id` | UUID | YES | | rastreio |
| `occurred_at` | TIMESTAMPTZ | NO | now() | |
| `status` | TEXT | NO | `'PENDING'` | event_status |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | |
| `deleted_at` | TIMESTAMPTZ | YES | | soft delete excepcional |

**Constraints**
- PK (`id`)
- FK `company_id` → `companies(id)`
- FK `actor_user_id` → `users(id)`

**Indexes**
- `idx_events_company_occurred` (`company_id`, `occurred_at`)
- `idx_events_company_type` (`company_id`, `type`)
- `idx_events_aggregate` (`aggregate_type`, `aggregate_id`)
- `idx_events_status` (`status`) WHERE `status <> 'PROCESSED'`

**Multi-tenancy:** sim (na prática quase sempre com `company_id`).  
**Soft delete:** coluna presente por convenção global; uso operacional deve ser raro (preferir retenção).  
**Imutabilidade:** updates de payload proibidos na aplicação; só transição de `status` de processamento.

---

### 3.9 `audit_logs`

| Coluna | Tipo | Null | Default | Descrição |
|---|---|---|---|---|
| `id` | UUID | NO | gen | PK |
| `company_id` | UUID | NO | | FK tenant |
| `actor_type` | TEXT | NO | | USER/SYSTEM/AI |
| `actor_user_id` | UUID | YES | | FK → users |
| `action` | VARCHAR(120) | NO | | ex.: `lead.update` |
| `target_type` | VARCHAR(64) | NO | | |
| `target_id` | UUID | NO | | |
| `before` | JSONB | YES | | snapshot |
| `after` | JSONB | YES | | snapshot |
| `ip` | VARCHAR(64) | YES | | |
| `user_agent` | VARCHAR(512) | YES | | |
| `occurred_at` | TIMESTAMPTZ | NO | now() | |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | |
| `deleted_at` | TIMESTAMPTZ | YES | | excepcional |

**Constraints**
- PK (`id`)
- FK `company_id` → `companies(id)`
- FK `actor_user_id` → `users(id)`
- CHECK `actor_type IN ('USER','SYSTEM','AI')`

**Indexes**
- `idx_audit_company_occurred` (`company_id`, `occurred_at`)
- `idx_audit_company_action` (`company_id`, `action`)
- `idx_audit_target` (`target_type`, `target_id`)
- `idx_audit_actor_user` (`actor_user_id`)

**Multi-tenancy:** sim.  
**Soft delete:** coluna por convenção; trilha deve ser tratada como append-only.

---

## 4. Relacionamentos (resumo)

| From | To | Cardinalidade | FK |
|---|---|---|---|
| memberships | companies | N:1 | `company_id` |
| memberships | users | N:1 | `user_id` |
| leads | companies | N:1 | `company_id` |
| leads | users | N:0..1 | `owner_id` |
| conversations | companies | N:1 | `company_id` |
| conversations | leads | N:1 | `lead_id` |
| messages | conversations | N:1 | `conversation_id` **obrigatória** |
| messages | companies | N:1 | `company_id` |
| follow_ups | companies | N:1 | `company_id` |
| follow_ups | leads | N:1 | `lead_id` |
| follow_ups | conversations | N:0..1 | `conversation_id` |
| follow_ups | messages | N:0..1 | `result_message_id` |
| events | companies | N:0..1 | `company_id` |
| audit_logs | companies | N:1 | `company_id` |

---

## 5. Tabelas explicitamente fora do MVP

- `recovery_campaigns` (D5 → V2)
- `lead_scores` (D4 → campo em `leads`)
- veículos, estoque, OS, financeiro, test drive, marketplace

---

## 6. Ordem sugerida de criação (futura migration)

1. `companies`
2. `users`
3. `memberships`
4. `leads`
5. `conversations`
6. `messages`
7. `follow_ups`
8. `events`
9. `audit_logs`

---

## 7. Critérios de aceite deste documento

- [ ] Enums D1/D3/D7 refletidos
- [ ] Unicidade (`company_id`, `phone`) em leads
- [ ] Message com `conversation_id` NOT NULL
- [ ] User sem `company_id`
- [ ] Membership como única ponte User↔Company
- [ ] Sem RecoveryCampaign / LeadScore table
- [ ] Soft delete em todas as tabelas
- [ ] Índices de tenant + status cobertos

**Após aprovação → etapa Prisma (`schema.prisma` + migration inicial).**
