# Database Validation — AutoPilot MVP

**Tipo:** Análise estática (pré-execução)  
**Escopo:** migrations M1/M2 + seeds + schema aprovado  
**Restrições desta etapa:** sem migrate, sem seed, sem conexão ao banco, sem alteração de código

**Fontes revisadas:**
- `prisma/schema.prisma`
- `prisma/migrations/20260801194800_init_mvp/migration.sql`
- `prisma/migrations/20260801194900_partial_uniques/migration.sql`
- `prisma/seeds/**`
- `docs/migration-plan.md`, `migration-review.md`, `seed-review.md`, `schema-audit.md`

**Veredito estático:**

> A camada de persistência está **pronta para execução controlada em ambiente local**.  
> Integridade referencial básica e índices do MVP estão coerentes.  
> Riscos remanescentes são **de aplicação** (tenant cross-FK, soft-delete filters, RLS ausente) — não bloqueiam Auth, mas devem entrar no checklist operacional.

---

## 1. Revisão das migrations

### M1 — `20260801194800_init_mvp`

| Item | Resultado estático |
|---|---|
| 8 enums | ✅ Alinhados ao schema aprovado |
| 9 tabelas | ✅ Ordem correta (companies/users → … → audit_logs) |
| Soft delete `deleted_at` | ✅ Presente em todas as tabelas |
| Timestamps `created_at` / `updated_at` | ✅ Presentes |
| `converted_at` / `first_response_at` | ✅ Presentes em `leads` |
| `users.email` UNIQUE | ✅ `users_email_key` |
| Índices RECOMMENDED | ✅ `last_inbound_at`, `created_at`, `converted_at`, `first_response_at`, `follow_ups.executed_at` |
| FKs | ✅ 21 constraints |
| Partial uniques | ✅ **Ausentes em M1** (correto) |
| Defaults de `id` / `updated_at` no SQL | ⚠️ Gerados pelo Prisma Client (não pelo Postgres) — esperado |

### M2 — `20260801194900_partial_uniques`

| Índice | Predicado | Status |
|---|---|---|
| `uq_leads_company_phone_active` | `deleted_at IS NULL` | ✅ |
| `uq_memberships_company_user_active` | `deleted_at IS NULL` | ✅ |
| `uq_conversations_company_channel_external_active` | `external_thread_id IS NOT NULL AND deleted_at IS NULL` | ✅ |
| `uq_messages_company_external_active` | `external_message_id IS NOT NULL AND deleted_at IS NULL` | ✅ |
| Sem `CONCURRENTLY` | Compatível com transaction Prisma | ✅ |

---

## 2. Revisão dos seeds

| Perfil | Volume alvo | Idempotência | Dados fake | Status estático |
|---|---|---|---|---|
| LOCAL | 1 company, 3 users, 50 leads | upsert slug/email/phone | ✅ | OK |
| DEMO | 2 companies, 5 users, 200 leads + msgs/follow-ups | idem | ✅ | OK |
| TEST | fixture mínima + factories | idem | ✅ | OK |

Pontos positivos:
- Ordem FK respeitada
- `passwordHash = null` (sem Auth)
- Preserva `firstResponseAt` / `convertedAt` no re-run
- Bloqueio de seed em `NODE_ENV=production`

Pontos de atenção (não bloqueantes):
- Seeds dependem de M1+M2 já aplicadas
- Identidade de follow-up via `suggestedBody contains [SEED:…]` (frágil se alguém editar o texto)
- JSON path filter em Event/Audit para idempotência (depende de suporte Postgres/Prisma)

---

## 3. Validação por tema

### 3.1 Integridade referencial

| Check | Status | Nota |
|---|---|---|
| Toda FK aponta para PK existente | ✅ | Declarado em M1 |
| Message exige Conversation | ✅ | `conversation_id NOT NULL` + FK RESTRICT |
| FollowUp → Message opcional | ✅ | `ON DELETE SET NULL` |
| Event.company opcional | ✅ | `ON DELETE SET NULL` |
| Igualdade `conversation.company_id = lead.company_id` | ❌ DB | **Não enforce** — risco cross-tenant lógico |
| Igualdade `message.company_id = conversation.company_id` | ❌ DB | **Não enforce** — app deve validar |
| Membership ativa para owner de lead | ❌ DB | Owner pode não ser membro da company |

**Conclusão:** Integridade estrutural OK; integridade de **tenant composto** é responsabilidade da aplicação.

### 3.2 Foreign Keys

Política observada:

| Padrão | Uso |
|---|---|
| `ON DELETE RESTRICT` | FKs obrigatórias de domínio/tenant (`company_id`, `lead_id`, `conversation_id`, membership user/company) |
| `ON DELETE SET NULL` | FKs opcionais (`owner_id`, `assigned_user_id`, `approved_by`, `result_message_id`, `invited_by`, event company/actor) |
| `ON UPDATE CASCADE` | Padrão Prisma |

Adequado ao soft delete (evita hard cascade).

### 3.3 Índices

| Categoria | Status |
|---|---|
| Tenant-aware (`company_id` prefix) nos caminhos quentes | ✅ |
| Recovery (`last_inbound_at`) | ✅ |
| Dashboard (`converted_at`, `executed_at`, `first_response_at`) | ✅ |
| Inbox (`last_message_at`) | ✅ |
| Sobreposição índice normal + partial unique | ⚠️ Aceitável (documentado) |
| Partial index `WHERE deleted_at IS NULL` de performance | ❌ Ainda não (opcional M3+) |

### 3.4 Partial unique indexes

| Regra de negócio | Cobertura M2 |
|---|---|
| Phone único por company (ativos) | ✅ |
| Membership único ativo | ✅ |
| Thread externa única | ✅ |
| Message externa única | ✅ |
| `companies.slug` unique | ❌ Intencional (não unique) |
| `users.email` partial w/ soft delete | ❌ Unique **total** — risco reuso pós soft-delete |

### 3.5 Soft delete

| Check | Status |
|---|---|
| Coluna `deleted_at` em todas as tabelas | ✅ |
| Partial uniques respeitam soft delete | ✅ (M2) |
| Filtro automático no DB/RLS | ❌ Não existe |
| Middleware Prisma soft-delete | ❌ Ainda não implementado |
| Seeds consultam `deletedAt: null` | ✅ |

**Risco:** queries de app sem filtro retornam “apagados”.

### 3.6 Multi-tenancy

| Check | Status |
|---|---|
| `company_id` em entidades de negócio | ✅ (exceto `users`) |
| Vínculo User↔Company via memberships | ✅ |
| Índices por tenant | ✅ |
| Postgres RLS | ❌ Não |
| TenantGuard / escopo obrigatório | ❌ Ainda não (pré-Auth) |
| `events.company_id` nullable | ⚠️ Eventos globais possíveis |

---

## 4. Checklist de execução local

> Executar **somente após aprovação explícita** desta validação.

### Preparação

- [ ] Docker disponível
- [ ] `cd apps/api`
- [ ] `.env` com `DATABASE_URL=postgresql://autopilot:autopilot@localhost:5432/autopilot?schema=public`
- [ ] `docker compose up -d postgres`
- [ ] Aguardar healthcheck (`pg_isready`)
- [ ] `npx prisma validate`
- [ ] `npx prisma generate`

### Migrations

- [ ] `npx prisma migrate deploy` (aplica M1 + M2)
- [ ] `npx prisma migrate status` → ambas applied
- [ ] Conferir tabelas: `\dt` ou Prisma Studio
- [ ] Conferir partial uniques: `\di *uq_*`

### Seeds (smoke)

- [ ] `npm run seed:test` (mínimo)
- [ ] `npm run seed:local`
- [ ] Re-run `npm run seed:local` (validar idempotência)
- [ ] Contagens coerentes com `seed-review.md`
- [ ] Tentar duplicar phone ativo → deve falhar (M2)

### App

- [ ] `npm run start:dev`
- [ ] `GET /health` → 200
- [ ] Swagger `/docs` → 200

### Critério de sucesso local

Migrations applied + seed local idempotente + health OK + partial unique rejeita duplicata.

---

## 5. Checklist de rollback

### Rollback M2 (seguro, preferencial)

```sql
DROP INDEX IF EXISTS uq_messages_company_external_active;
DROP INDEX IF EXISTS uq_conversations_company_channel_external_active;
DROP INDEX IF EXISTS uq_memberships_company_user_active;
DROP INDEX IF EXISTS uq_leads_company_phone_active;
```

- [ ] Executar SQL acima
- [ ] Registrar migration como rolled back / forward-fix se necessário
- [ ] App continua funcional (sem enforce de unicidade parcial)

### Rollback local total (DB descartável)

- [ ] `npx prisma migrate reset` **somente local**
- [ ] Ou `docker compose down -v` + subir Postgres limpo
- [ ] Reaplicar migrate + seed se preciso

### Rollback staging/prod (não local)

- [ ] **Não** usar `migrate reset`
- [ ] Restaurar backup/snapshot pré-migrate
- [ ] Ou forward-fix com nova migration
- [ ] Validar `migrate status` após restore

### Rollback de seed

- [ ] Soft-delete companies seed (`local-demo`, `demo-*`, `test-fixture`) **ou**
- [ ] Reset DB local
- [ ] Nunca hard-delete seletivo ad-hoc em prod

---

## 6. Checklist de backup

### Antes de qualquer migrate em DB compartilhado

- [ ] Snapshot do volume Postgres / `pg_dump`
- [ ] Nomear backup: `autopilot_<env>_<YYYYMMDD_HHMM>_pre_migrate.dump`
- [ ] Validar restore dry-run em DB efêmero (staging)
- [ ] Guardar checksum / path do artefato
- [ ] Definir owner do restore (quem executa se falhar)

### Comandos de referência (não executar agora)

```bash
# Dump
pg_dump "$DATABASE_URL" -Fc -f "autopilot_local_pre_migrate.dump"

# Restore (DB destino vazio)
pg_restore -d "$DATABASE_URL" --clean --if-exists "autopilot_local_pre_migrate.dump"
```

### Local

- [ ] Opcional: dump antes do primeiro migrate (bom hábito)
- [ ] Volumes Docker: `docker compose down` **sem** `-v` preserva dados

### Produção (futuro)

- [ ] Backup automatizado diário
- [ ] Backup imediato pré-deploy de migration
- [ ] Retenção mínima definida (ex.: 7–30 dias)
- [ ] Teste de restore periódico

---

## 7. Plano de observabilidade inicial do banco

### 7.1 Sinais mínimos (MVP)

| Sinal | Como |
|---|---|
| Conectividade | healthcheck Postgres + futuro `/health/ready` com `$queryRaw SELECT 1` |
| Migrations | `prisma migrate status` no CI/deploy |
| Tamanho DB | `pg_database_size` semanal |
| Linhas por tabela | contagem `leads/messages/events` por company (job manual/MVP) |
| Locks / queries lentas | `pg_stat_activity` + `pg_stat_statements` (se habilitado) |
| Erros de unique/FK | logs da app (Prisma error codes `P2002`, `P2003`) |

### 7.2 Alertas iniciais sugeridos

1. Postgres down / connection refused  
2. Migration deploy falhou no pipeline  
3. Disco > 80%  
4. Taxa de erros `P2002` (unique) acima do baseline pós-seed  
5. Crescimento anormal de `events` / `audit_logs`

### 7.3 Queries de inspeção (pós-execução)

```sql
-- Partial uniques existem?
SELECT indexname, indexdef
FROM pg_indexes
WHERE indexname LIKE 'uq_%';

-- Contagem por tabela
SELECT 'leads' AS t, count(*) FROM leads WHERE deleted_at IS NULL
UNION ALL
SELECT 'messages', count(*) FROM messages WHERE deleted_at IS NULL;

-- Possível vazamento lógico (cross-tenant) — deve retornar 0
SELECT c.id
FROM conversations c
JOIN leads l ON l.id = c.lead_id
WHERE c.company_id <> l.company_id;
```

### 7.4 Fora do MVP inicial

- APM completo
- Particionamento
- RLS policies monitoring
- Réplicas read-only

---

## 8. Matriz de riscos (análise estática)

| ID | Risco | Severidade | Bloqueia Auth? | Mitigação |
|---|---|---|---|---|
| R1 | Cross-tenant FK lógico (company_id divergente entre lead/conversation/message) | **Alta** | Não | Validação na app + query de inspeção §7.3 |
| R2 | Soft delete sem middleware → vazamento de registros “apagados” | **Alta** | Não | Middleware Prisma antes dos CRUDs |
| R3 | Sem RLS no Postgres | **Média** | Não | TenantGuard rigoroso; RLS em V2 |
| R4 | `users.email` unique total vs soft delete | **Média** | Parcial (Auth) | Anonimizar email no soft delete |
| R5 | Defaults `id`/`updated_at` só no Client | **Baixa** | Não | Evitar inserts SQL crus |
| R6 | Seed follow-up idempotência por texto | **Baixa** | Não | Aceitável MVP; evoluir chave dedicada depois |
| R7 | Event.company_id null | **Baixa** | Não | Evitar listagens sem filtro |
| R8 | Índices duplicados (btree + partial unique) | **Baixa** | Não | Monitorar; limpar depois se necessário |
| R9 | Score sem CHECK 0–100 no DB | **Baixa** | Não | Validação app/DTO |
| R10 | Executar migrate no DB errado | **Alta** | N/A | Checklist `DATABASE_URL` + backup |

---

## 9. Pronto para quê?

| Etapa | Pronto? |
|---|---|
| Executar migrate+seed **local** | ✅ Sim, após aprovação |
| Iniciar Auth | ✅ Schema/seeds suficientes como base |
| Produção | ❌ Não — falta backup automatizado, RLS/guards, middleware soft-delete, smoke em staging |

---

## 10. Decisão solicitada

Aprovar esta validação para liberar a **execução local** na ordem:

1. `docker compose up -d postgres`
2. `prisma migrate deploy`
3. `npm run seed:test` → `seed:local`
4. Smoke `/health`

**Sem aprovação: não executar nada no banco.**
