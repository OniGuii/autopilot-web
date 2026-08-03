# Plano de Migrations — AutoPilot MVP

**Status:** Planejamento (sem execução)  
**Schema:** `apps/api/prisma/schema.prisma` (pacote RECOMMENDED A+B)  
**Referências:** `database-model.md`, `prisma-review.md`, `schema-audit.md`, `seed-strategy.md`

> **Esta etapa não cria e não executa migrations.**  
> Nenhuma pasta `prisma/migrations` deve ser gerada até aprovação explícita.

---

## 0. Estratégia geral

### Abordagem em 2 passos (recomendada)

| Passo | Artefato | Conteúdo |
|---|---|---|
| **M1** | Migration Prisma gerada do schema | Enums, tabelas, PKs, FKs, índices `@@index`, `User.email @unique` |
| **M2** | Migration SQL customizada | Partial unique indexes (`WHERE deleted_at IS NULL` …) |

Motivo: Prisma não modela partial unique nativamente. Separar M2 evita drift e deixa o SQL auditável.

### Alternativa (aceitável)

Uma única migration Prisma + bloco `SQL` manual no final do mesmo arquivo — desde que documentado e revisado.

### O que **não** fazer no MVP

- `prisma db push` em staging/produção
- Editar migrations já aplicadas
- Hard deletes / `DROP TABLE` em produção sem plano
- Partial unique no `schema.prisma` via `@@unique` (decisão congelada)

---

## 1. Ordem de criação das tabelas

Ordem oficial (respeita FKs e o aggregate Conversation → Message):

| # | Tabela | Justificativa |
|---|---|---|
| 1 | `companies` | Raiz do tenant. Nenhuma FK de negócio aponta para ela como dependência inversa obrigatória. |
| 2 | `users` | Identidade global. Sem `company_id`. Necessária antes de Membership e FKs opcionais (`owner_id`, etc.). |
| 3 | `memberships` | Ponte User↔Company. Depende de `companies` + `users`. |
| 4 | `leads` | Depende de `companies` (+ `users` opcional via `owner_id`). Base de Conversations/FollowUps. |
| 5 | `conversations` | Depende de `companies` + `leads` (+ `users` opcional). Aggregate root de messages. |
| 6 | `messages` | Depende de `conversations` (obrigatório) + `companies`. Deve existir **antes** de `follow_ups.result_message_id`. |
| 7 | `follow_ups` | Depende de `leads`, `companies`, opcionalmente `conversations`, `messages`, `users`. |
| 8 | `events` | Depende opcionalmente de `companies` / `users`. Append-only; sem filhos. |
| 9 | `audit_logs` | Depende de `companies` (+ `users` opcional). Append-only; sem filhos. |

### Diagrama de dependência

```text
companies ──┐
            ├── memberships
users ──────┤
            ├── leads ──┬── conversations ── messages ──┐
            │           └──────── follow_ups ◄───────────┘
            ├── events
            └── audit_logs
```

### Enums

Criados **antes** das tabelas que os usam (Prisma emite `CREATE TYPE` no início de M1):

`CompanyStatus`, `UserStatus`, `MembershipRole`, `LeadStatus`, `ConversationStatus`, `Channel`, `MessageDirection`, `FollowUpStatus`

---

## 2. Foreign Keys

### Lista completa

| Tabela | Coluna FK | Referencia | Null | Notas |
|---|---|---|---|---|
| `memberships` | `company_id` | `companies.id` | NO | tenant |
| `memberships` | `user_id` | `users.id` | NO | membro |
| `memberships` | `invited_by` | `users.id` | YES | convite |
| `leads` | `company_id` | `companies.id` | NO | tenant |
| `leads` | `owner_id` | `users.id` | YES | responsável |
| `conversations` | `company_id` | `companies.id` | NO | tenant |
| `conversations` | `lead_id` | `leads.id` | NO | aggregate pai lógico |
| `conversations` | `assigned_user_id` | `users.id` | YES | atendente |
| `messages` | `company_id` | `companies.id` | NO | tenant desnormalizado |
| `messages` | `conversation_id` | `conversations.id` | NO | **obrigatória (D9)** |
| `messages` | `sender_user_id` | `users.id` | YES | remetente user |
| `follow_ups` | `company_id` | `companies.id` | NO | tenant |
| `follow_ups` | `lead_id` | `leads.id` | NO | alvo |
| `follow_ups` | `conversation_id` | `conversations.id` | YES | contexto |
| `follow_ups` | `assigned_user_id` | `users.id` | YES | responsável |
| `follow_ups` | `approved_by` | `users.id` | YES | aprovação híbrida |
| `follow_ups` | `result_message_id` | `messages.id` | YES | mensagem enviada |
| `events` | `company_id` | `companies.id` | YES | opcional (eventos globais) |
| `events` | `actor_user_id` | `users.id` | YES | ator |
| `audit_logs` | `company_id` | `companies.id` | NO | tenant |
| `audit_logs` | `actor_user_id` | `users.id` | YES | ator |

### Dependências críticas

1. **Message → Conversation** é a FK mais rígida do domínio (D9).
2. **FollowUp → Message** cria dependência na ordem: `messages` antes de `follow_ups`.
3. **Não há FK** que garanta `conversation.company_id = lead.company_id` — enforce na aplicação.
4. Política de delete: com soft delete, FKs devem permanecer `ON DELETE RESTRICT` / `NO ACTION` (default Prisma). Nunca `CASCADE` hard delete no MVP.

### Unique nativo do Prisma (M1)

| Constraint | Tabela | Observação |
|---|---|---|
| `users.email` | `users` | `@unique` global aprovado (não é partial) |

---

## 3. Partial Unique Indexes (SQL customizado — M2)

### Objetivo

Garantir unicidade de negócio **apenas entre registros ativos** (`deleted_at IS NULL`), permitindo recriar após soft delete.

### Índices oficiais

#### 3.1 Lead — telefone único por company (D6)

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_leads_company_phone_active
ON leads (company_id, phone)
WHERE deleted_at IS NULL;
```

#### 3.2 Membership — um vínculo ativo User↔Company

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_memberships_company_user_active
ON memberships (company_id, user_id)
WHERE deleted_at IS NULL;
```

#### 3.3 Conversation — thread externa única por company+canal

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_conversations_company_channel_external_active
ON conversations (company_id, channel, external_thread_id)
WHERE external_thread_id IS NOT NULL
  AND deleted_at IS NULL;
```

#### 3.4 Message — idempotência de mensagem externa

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_messages_company_external_active
ON messages (company_id, external_message_id)
WHERE external_message_id IS NOT NULL
  AND deleted_at IS NULL;
```

### Notas operacionais

| Tópico | Decisão |
|---|---|
| `CONCURRENTLY` | Preferir em staging/produção para não lockar tabela; **não** roda dentro de transaction block no Postgres — Prisma migrations rodam em transação por padrão. |
| Transação Prisma vs CONCURRENTLY | Em M2: ou (a) SQL **sem** `CONCURRENTLY` dentro da migration Prisma, ou (b) script ops separado com `CONCURRENTLY` fora do migrate. **MVP local/staging:** sem `CONCURRENTLY` é aceitável. **Produção com dados:** avaliar script ops. |
| SQL previsto para M2 (dev/CI, dentro da migration) | Versão **sem** `CONCURRENTLY` (abaixo). |

#### SQL M2 (compatível com migration Prisma / transaction)

```sql
-- M2: partial unique indexes (AutoPilot MVP)

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

### Explicitamente fora de M2

- `companies.slug` — **não** unique (decisão aprovada)
- `users.email` — já coberto por `@unique` em M1 (não partial)

### Partial indexes de performance (opcional, não bloqueante do MVP)

Podem vir em M3+ se soft-deleted crescer:

```sql
-- Exemplo futuro (não obrigatório agora)
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_company_status_active
-- ON leads (company_id, status)
-- WHERE deleted_at IS NULL;
```

---

## 4. Rollback

### Princípios

1. Migrations Prisma são **versionadas e forward-first**.
2. Em local/staging: rollback via `migrate reset` ou down SQL explícito é aceitável.
3. Em produção: preferir **migration reversa nova** (forward fix) em vez de `migrate resolve` improvisado.

### Rollback M1 (schema base)

Se M1 falhar no meio:

- Transação Postgres aborta → DB permanece no estado anterior (se o provider aplicar M1 em transaction — padrão Prisma).
- Se parcial (raro/enums): restaurar backup / recriar DB vazio em local.

Down SQL conceitual (somente ambientes descartáveis):

```sql
-- Ordem inversa de DROP (conceitual; preferir migrate reset em local)
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS follow_ups;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS leads;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS companies;
-- DROP TYPEs dos enums...
```

### Rollback M2 (partial uniques)

```sql
DROP INDEX IF EXISTS uq_messages_company_external_active;
DROP INDEX IF EXISTS uq_conversations_company_channel_external_active;
DROP INDEX IF EXISTS uq_memberships_company_user_active;
DROP INDEX IF EXISTS uq_leads_company_phone_active;
```

Seguro e não destrutivo de dados.

### Estratégia por ambiente

| Ambiente | Rollback |
|---|---|
| Local | `prisma migrate reset` (+ reseed) |
| Staging | Reverter M2 com `DROP INDEX`; se M1 ruim, restore snapshot |
| Produção | Backup pré-deploy obrigatório; M2 reversível; M1 só em janela com restore plan |

---

## 5. Ambientes

| Ambiente | Comando típico | Regras |
|---|---|---|
| **Local** | `prisma migrate dev` (quando aprovado) | DB Docker; pode resetar; rodar M1+M2; seed `local` |
| **Staging** | `prisma migrate deploy` | Sem reset; aplicar M1→M2; seed `staging` controlado |
| **Produção** | `prisma migrate deploy` | Sem reset; backup; M1→M2; **sem seed de demo**; checklist §8 |

### Variáveis mínimas

- `DATABASE_URL` válido e apontando ao DB correto do ambiente
- App **não** sobe CRUDs que violem partial uniques antes de M2 em cada ambiente

### Fluxo de promoção

```text
Local (migrate dev + seed)
    → PR / CI (migrate deploy em DB efêmero + testes)
    → Staging (migrate deploy + smoke)
    → Produção (backup → migrate deploy → smoke)
```

---

## 6. Seed Strategy (ordem)

Fonte: `seed-strategy.md`. Seeds **só depois** de M1+M2 aplicados.

### Ordem obrigatória de insert

1. `companies`
2. `users`
3. `memberships`
4. `leads` (phones únicos por company — respeita partial unique)
5. `conversations`
6. `messages` (`external_message_id` únicos quando presentes)
7. `follow_ups` (`EXECUTED` com `approved_by`; `result_message_id` após messages)
8. `events`
9. `audit_logs`

### Perfis

| Perfil | Quando |
|---|---|
| `local` | Após migrate local |
| `staging` | Após migrate staging (dados de QA) |
| `demo` | Ambiente de demo dedicado |
| `test` | Factories/fixtures — não seed global pesado |

### Cuidados com M2

- Re-seed sem limpar phones ativos → falha em `uq_leads_company_phone_active`
- Soft-delete + recreate do mesmo phone → permitido
- `users.email` `@unique` total: soft-delete sem anonimizar email bloqueia reseed do mesmo email

---

## 7. Riscos — o que pode falhar

| Risco | Momento | Sintoma | Mitigação |
|---|---|---|---|
| Ordem FK invertida | M1 | `relation does not exist` | Seguir ordem §1 |
| Enum já existente | Re-run parcial | `type already exists` | Não editar M1 aplicada; nova migration |
| Partial unique com duplicatas | M2 | `could not create unique index` | Limpar duplicatas antes de M2; em DB novo, ok |
| `CONCURRENTLY` dentro de transaction | M2 mal escrito | erro Postgres | Usar SQL sem `CONCURRENTLY` na migration Prisma |
| Drift schema vs DB | qualquer | Prisma diverge | Nunca `db push` em shared envs |
| Seed antes de M2 | seed | duplicatas silenciosas depois | Sempre M1→M2→seed |
| Deploy prod sem backup | M1 | restore impossível | Checklist §8 |
| `DATABASE_URL` errada | deploy | migrate no DB errado | Confirmar host/db/name |
| Lock longo em prod | M1 índices | timeout | Janela; monitorar; índices já no CREATE TABLE ajudam |
| Cross-tenant data na app | pós-migrate | não é falha SQL | Guards — fora da migration |

### Migrations “mais sensíveis”

1. **M1** — cria tudo; maior superfície.
2. **M2** — falha se já houver duplicatas (só relevante em DB não vazio).

---

## 8. Checklist final — antes de `migrate deploy`

### Schema & docs

- [ ] `schema.prisma` = RECOMMENDED (A+B) aprovado
- [ ] `prisma validate` OK
- [ ] `prisma generate` OK
- [ ] `migration-plan.md` aprovado
- [ ] Partial uniques SQL revisados (§3)

### Banco alvo

- [ ] `DATABASE_URL` confere com o ambiente
- [ ] Extensões Postgres necessárias disponíveis (UUID nativo ok no PG 13+)
- [ ] Backup / snapshot (staging compartilhado e produção)
- [ ] DB acessível da máquina/CI/Coolify

### Pipeline de migrate

- [ ] Plano M1 então M2 (ou arquivo único revisado)
- [ ] Sem `CONCURRENTLY` dentro de transaction Prisma (ou script ops separado)
- [ ] Estratégia de rollback M2 documentada e testada em staging
- [ ] CI consegue subir Postgres e aplicar migrations em job efêmero

### Pós-migrate (smoke)

- [ ] `\dt` / Prisma Studio: 9 tabelas presentes
- [ ] Enums criados
- [ ] FKs presentes (`information_schema` ou `\d tabela`)
- [ ] 4 partial unique indexes existem
- [ ] `User.email` unique existe
- [ ] Insert smoke: company → user → membership → lead
- [ ] Insert duplicado `(company_id, phone)` ativo **falha**
- [ ] Soft-delete lead + reinsert mesmo phone **sucesso**
- [ ] Seed perfil do ambiente (se aplicável) OK
- [ ] App sobe (`start:dev` / prod) sem erro de Prisma Client

### Produção (extra)

- [ ] Janela de manutenção comunicada (se necessário)
- [ ] Rollback/restore owner definido
- [ ] Sem seed demo
- [ ] Monitoramento de locks/erros habilitado

---

## 9. Comandos previstos (não executar agora)

```bash
# Somente após aprovação explícita desta etapa

# Local
npx prisma migrate dev --name init_mvp          # M1 (nome ilustrativo)
# adicionar M2 SQL partial uniques
npx prisma migrate dev --name partial_uniques   # ou editar SQL custom

# Staging / Produção
npx prisma migrate deploy
```

---

## 10. Critério de saída desta etapa

Este plano está **pronto para implementação** quando:

1. Documento aprovado
2. Decisão confirmada: M1+M2 separados **ou** arquivo único
3. Política `CONCURRENTLY` vs transaction confirmada por ambiente
4. Autorização explícita para gerar/aplicar migrations

---

## 11. Fora do escopo atual

- Criar arquivos em `prisma/migrations`
- Executar `prisma migrate dev|deploy`
- Implementar seeds
- Alterar `schema.prisma`

---

**Aguardo aprovação do `migration-plan.md` antes de qualquer migrate.**
