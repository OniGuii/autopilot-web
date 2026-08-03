# Migration Review — AutoPilot MVP

**Status:** Migrations **geradas**, **não aplicadas**  
**Schema:** inalterado (`apps/api/prisma/schema.prisma`)  
**Plano:** `docs/migration-plan.md`

---

## 1. Migrations criadas

| # | Pasta | Tipo | Aplicada? |
|---|---|---|---|
| M1 | `prisma/migrations/20260801194800_init_mvp` | Prisma diff → SQL completo do schema | **Não** |
| M2 | `prisma/migrations/20260801194900_partial_uniques` | SQL customizado (partial uniques) | **Não** |

Lock file: `prisma/migrations/migration_lock.toml` (`provider = postgresql`)

### Como foram geradas

- **M1:** `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`  
  (sem `migrate dev`, sem aplicar no banco)
- **M2:** SQL manual conforme `migration-plan.md` §3 (sem `CONCURRENTLY`, compatível com transaction do Prisma)

---

## 2. SQL gerado — resumo

### M1 — `20260801194800_init_mvp/migration.sql` (~376 linhas)

Inclui:

1. `CREATE SCHEMA IF NOT EXISTS "public"`
2. **8 enums** (`CREATE TYPE`)
3. **9 tabelas** (`CREATE TABLE`)
4. **Índices** do schema (`CREATE INDEX` + `users_email_key` unique)
5. **21 foreign keys** (`ADD CONSTRAINT ... FOREIGN KEY`)

**Não inclui** partial unique indexes (`WHERE deleted_at IS NULL`).

### M2 — `20260801194900_partial_uniques/migration.sql`

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_company_phone_active
ON leads (company_id, phone)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_company_user_active
ON memberships (company_id, user_id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_company_channel_external_active
ON conversations (company_id, channel, external_thread_id)
WHERE external_thread_id IS NOT NULL
  AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_company_external_active
ON messages (company_id, external_message_id)
WHERE external_message_id IS NOT NULL
  AND deleted_at IS NULL;
```

---

## 3. Tabelas afetadas

| Tabela | M1 | M2 |
|---|---|---|
| `companies` | create + indexes | — |
| `users` | create + `email` unique + status index | — |
| `memberships` | create + indexes + FKs | partial unique `(company_id, user_id)` |
| `leads` | create + indexes (incl. RECOMMENDED) + FKs | partial unique `(company_id, phone)` |
| `conversations` | create + indexes + FKs | partial unique `(company_id, channel, external_thread_id)` |
| `messages` | create + indexes + FKs | partial unique `(company_id, external_message_id)` |
| `follow_ups` | create + indexes (incl. `executed_at`) + FKs | — |
| `events` | create + indexes + FKs | — |
| `audit_logs` | create + indexes + FKs | — |

### Enums (M1)

`CompanyStatus` · `UserStatus` · `MembershipRole` · `LeadStatus` · `ConversationStatus` · `Channel` · `MessageDirection` · `FollowUpStatus`

---

## 4. Índices criados

### M1 — índices do Prisma (não únicos, exceto email)

| Origem | Exemplos |
|---|---|
| Company | `status`, `slug` |
| User | **`email` UNIQUE**, `status` |
| Membership | `company_id`, `user_id`, `(company_id, user_id)`, `(company_id, role)` |
| Lead | `(company_id, phone/status/owner/last_contact/last_inbound/score/created_at/converted_at/first_response_at)` |
| Conversation | `(company_id, lead_id/status/last_message_at)`, `(company_id, channel, external_thread_id)` |
| Message | `(conversation_id, created_at)`, `(company_id, created_at/status/external_message_id)` |
| FollowUp | `(company_id, status/scheduled_at/executed_at/lead_id)` |
| Event / AuditLog | conforme schema |

### M2 — partial uniques

| Nome | Colunas | Predicado |
|---|---|---|
| `uq_leads_company_phone_active` | `company_id, phone` | `deleted_at IS NULL` |
| `uq_memberships_company_user_active` | `company_id, user_id` | `deleted_at IS NULL` |
| `uq_conversations_company_channel_external_active` | `company_id, channel, external_thread_id` | `external_thread_id IS NOT NULL AND deleted_at IS NULL` |
| `uq_messages_company_external_active` | `company_id, external_message_id` | `external_message_id IS NOT NULL AND deleted_at IS NULL` |

### Nota de sobreposição

M1 já cria índices **não únicos** em pares como `(company_id, phone)`.  
M2 adiciona **unique parcial** nas mesmas colunas (com `WHERE`).  
Isso é intencional: o índice Prisma serve buscas; o partial unique enforce a regra de negócio com soft delete. Redundância leve, aceitável no MVP.

---

## 5. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| Aplicar no DB errado | Alta | Conferir `DATABASE_URL` no checklist |
| M2 falhar por duplicatas (DB não vazio) | Média | Em DB novo (MVP): ok; senão limpar duplicatas antes |
| Drift se alguém rodar `db push` | Alta | Só `migrate deploy` / `migrate dev` controlado |
| Shadow DB / `migrate dev` reescrever SQL | Média | Preferir `migrate deploy` em staging/prod; local: revisar diff |
| Índices duplicados (btree + partial unique) | Baixa | Monitorar; remover índice não-único redundante só se necessário depois |
| `User.email` unique total vs soft delete | Média | Política de anonimização no soft delete (app) |
| Migrations criadas offline (`migrate diff`) | Baixa | Validar com `migrate deploy` em DB limpo na próxima etapa aprovada |

---

## 6. Comandos necessários para execução

> **Não executar agora.** Aguardar aprovação explícita.

### Pré-requisitos

```bash
cd apps/api
cp -n .env.example .env   # se necessário
# Postgres acessível via DATABASE_URL
docker compose up -d postgres   # ambiente local típico
npx prisma validate
npx prisma generate
```

### Local (primeira vez, DB vazio)

```bash
# Aplica M1 + M2 na ordem
npx prisma migrate deploy

# Alternativa em dev (pode pedir nome / shadow DB):
# npx prisma migrate dev
```

### Staging / Produção

```bash
npx prisma migrate deploy
```

### Verificação pós-execução

```bash
npx prisma migrate status
# Conferir 4 partial uniques:
# psql $DATABASE_URL -c "\d leads"
# psql $DATABASE_URL -c "\di *uq_*"
```

### Rollback M2 (se necessário)

```sql
DROP INDEX IF EXISTS uq_messages_company_external_active;
DROP INDEX IF EXISTS uq_conversations_company_channel_external_active;
DROP INDEX IF EXISTS uq_memberships_company_user_active;
DROP INDEX IF EXISTS uq_leads_company_phone_active;
```

### Local — reset total (descartável)

```bash
npx prisma migrate reset
# re-aplica migrations + opcional seed futuro
```

---

## 7. O que foi propositadamente NÃO feito

- [x] Schema Prisma **não** alterado
- [x] `migrate dev` **não** executado (aplicação)
- [x] `migrate deploy` **não** executado
- [x] Banco **não** modificado
- [x] Seeds **não** rodados

---

## 8. Checklist rápido antes da aprovação de execução

- [ ] Revisar SQL M1 (`prisma/migrations/20260801194800_init_mvp/migration.sql`)
- [ ] Revisar SQL M2 (`prisma/migrations/20260801194900_partial_uniques/migration.sql`)
- [ ] Postgres do ambiente alvo no ar
- [ ] `DATABASE_URL` correto
- [ ] Backup (staging compartilhado / produção)
- [ ] Autorização explícita para executar

---

**Aguardar aprovação antes de qualquer execução no banco.**
