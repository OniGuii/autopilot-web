# Fase 8B — Database Security & Scale (RLS Review)

**Status:** Implementado  
**Escopo:** PostgreSQL RLS + session GUC + índices de escala + query audit + alertas DB  
**Fora de escopo:** Outbound Worker, mudanças de domínio, mudanças de APIs públicas  
**Relacionados:** `tenant-safety.md`, `prisma-extensions.md`, `observability-review.md`

---

## 1. Resumo

Defesa em profundidade sobre a **Tenant Extension** (app). O banco passa a filtrar por `company_id` via RLS com `FORCE ROW LEVEL SECURITY`. A aplicação continua obrigando tenant no Prisma; RLS é a rede de segurança contra bugs de filtro.

```text
Request/Worker ALS (companyId)
  → Prisma Tenant Extension (where companyId)
  → RLS Session Extension (SET LOCAL app.company_id)
  → PostgreSQL POLICY (company_id = current_setting)
```

---

## 2. Tabelas sob RLS

| Tabela | Policy | Notas |
|---|---|---|
| `leads` | `tenant_isolation` ALL | USING + WITH CHECK |
| `conversations` | idem | |
| `messages` | idem | |
| `follow_ups` | idem | |
| `events` | idem | `company_id` nullable — rows null só com bypass |
| `audit_logs` | idem | |
| `webhook_events` | idem | |
| `whatsapp_instances` | SELECT aberto; INSERT/UPDATE/DELETE tenant | Bootstrap webhook por `instanceKey` antes do GUC |

Migration: `prisma/migrations/20260804180000_rls_tenant_policies/`.

Helpers SQL:

- `autopilot_rls_company_id()` → `NULLIF(current_setting('app.company_id', true), '')::uuid`
- `autopilot_rls_bypass()` → `current_setting('app.rls_bypass', true) = 'on'`

---

## 3. Session Context

| GUC | Escopo | Quem seta |
|---|---|---|
| `app.company_id` | `SET LOCAL` (transaction) | `createRlsSessionExtension` via `applyRlsSessionGuc` |
| `app.rls_bypass` | `SET LOCAL` (ou session no seed) | bypass ALS / seed |

Fontes de `companyId`:

| Path | Mecanismo |
|---|---|
| HTTP request | Auth + request context ALS |
| BullMQ worker | `withBullJobContext` (payload.companyId) |
| WhatsApp webhook (após lookup) | `runWithRequestContextAsync({ companyId })` |
| Reconcile por company | `runWithRequestContextAsync({ companyId })` |
| FollowUp due scanner / reconcile discovery | `runWithRlsBypassAsync` |

Arquivos:

- `src/prisma/rls-session.ts`
- `src/prisma/rls-context.ts`
- `src/prisma/extensions/rls-session.extension.ts`

Tenant Extension **permanece ativa** (`enforce: true`).

---

## 4. Admin bypass

| Uso | Como |
|---|---|
| Seeds | `set_config('app.rls_bypass','on', false)` no início de `prisma/seed.ts` |
| Migrations com DML | Prefixo `SELECT set_config('app.rls_bypass','on', true);` no SQL |
| Scanners cross-tenant | `runWithRlsBypassAsync` (due follow-ups, reconcile company discovery) |

`FORCE ROW LEVEL SECURITY` aplica RLS também ao owner da tabela — bypass explícito é obrigatório para seeds/scanners.

Não usar bypass em requests de produto.

---

## 5. Índices sugeridos / aplicados (escala)

Migration: `prisma/migrations/20260804180100_scale_indexes/`.

Índices **parciais** (não espelhados no `schema.prisma` — Prisma não modela `WHERE` de forma estável):

| Índice | Área | Justificativa |
|---|---|---|
| `follow_ups_status_scheduled_at_due_idx` | Ops / FollowUp scanner | Due scan: `STATUS=SCHEDULED` + `scheduled_at` |
| `follow_ups_status_updated_at_idx` | Ops / Reconcile | Stuck `EXECUTING` por `updated_at` |
| `messages_status_created_at_pending_idx` | Ops / WhatsApp | PENDING outbound stale |
| `messages_company_conversation_created_idx` | AI | Histórico da conversa ordenado |
| `webhook_events_status_received_at_idx` | Ops / WhatsApp | RECEIVED stale |
| `leads_company_created_active_idx` | Dashboard | KPIs por janela `created_at` |

Índices compostos tenant já existentes (`company_id, …`) cobrem listagens Dashboard/Inbox/FollowUps.

### Revisões por superfície

| Superfície | Consultas críticas | Índice |
|---|---|---|
| Dashboard | leads por company + created_at | parcial + `@@index([companyId, createdAt])` |
| Ops | pending messages, executing FUs, webhooks | parciais status/* |
| WhatsApp | webhook por instanceKey (unique); events por status | unique + parcial status |
| AI | messages por conversation + created_at | `messages_company_conversation_created_idx` |

---

## 6. Query Audit (EXPLAIN ANALYZE)

Ambiente: Postgres local pós-migrate/seed (`2026-08-04`). GUCs:

```sql
SELECT set_config('app.rls_bypass', 'off', false);
SELECT set_config('app.company_id', '<company-uuid>', false);
```

### 6.1 Dashboard — leads recentes

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM leads
WHERE company_id = current_setting('app.company_id')::uuid
  AND deleted_at IS NULL
  AND created_at >= NOW() - INTERVAL '30 days'
ORDER BY created_at DESC
LIMIT 50;
```

**Observado (dataset pequeno):** Seq Scan (~0.2ms) — planner preferiu heap por cardinalidade baixa.  
Com `enable_seqscan=off`: Bitmap Index Scan em índice `company_id` existente (~0.13ms).  
`leads_company_created_active_idx` fica disponível para janelas maiores em produção.

### 6.2 Ops — PENDING outbound stale

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM messages
WHERE deleted_at IS NULL
  AND status = 'PENDING'
  AND created_at < NOW() - INTERVAL '5 minutes'
ORDER BY created_at ASC
LIMIT 100;
```

**Observado:** `Index Scan using messages_status_created_at_pending_idx` — Execution Time ~0.02ms.

### 6.3 FollowUp due scanner

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, company_id FROM follow_ups
WHERE deleted_at IS NULL
  AND status = 'SCHEDULED'
  AND scheduled_at IS NOT NULL
  AND scheduled_at <= NOW()
ORDER BY scheduled_at ASC
LIMIT 100;
```

**Observado (com bypass):** `Bitmap Index Scan on follow_ups_status_scheduled_at_due_idx` — ~0.03ms.

### 6.4 AI — contexto de mensagens

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, body, direction, created_at FROM messages
WHERE company_id = current_setting('app.company_id')::uuid
  AND conversation_id = '<conversation-uuid>'
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 30;
```

**Observado:** `Bitmap Index Scan on messages_company_conversation_created_idx` — ~0.13ms.

### 6.5 WhatsApp — webhook events RECEIVED stale

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, company_id FROM webhook_events
WHERE deleted_at IS NULL
  AND status = 'RECEIVED'
  AND received_at < NOW() - INTERVAL '5 minutes'
ORDER BY received_at ASC
LIMIT 100;
```

**Observado (com bypass):** `Index Scan using webhook_events_status_received_at_idx` — ~0.02ms.

> Re-coletar planos com `EXPLAIN (ANALYZE, BUFFERS)` no ambiente alvo após deploy.

---

## 7. Observabilidade — alertas 8B

| Código | Fonte | Threshold (default) |
|---|---|---|
| `SLOW_QUERY` | Janela 15m de `prisma_slow_queries` (`OBS_PRISMA_SLOW_MS`) | `OBS_SLOW_QUERY_ALERT_MIN=5` |
| `FULL_TABLE_SCAN` | `pg_stat_user_tables` em tabelas RLS | `seq_scan ≥ OBS_FULL_TABLE_SCAN_SEQ_MIN` e razão vs `idx_scan ≥ OBS_FULL_TABLE_SCAN_RATIO` |

Expostos em `GET /api/ops/alerts` (mesmo contrato; novos códigos adicionais).  
Métrica Prometheus: `prisma_slow_queries_total` (8A).

---

## 8. Rollback

1. `prisma migrate resolve` / nova migration `DISABLE ROW LEVEL SECURITY` nas 8 tabelas (ou drop policies).
2. Remover `createRlsSessionExtension` de `PrismaService` (manter tenant extension).
3. Flags de alerta: elevar `OBS_SLOW_QUERY_ALERT_MIN` / `OBS_FULL_TABLE_SCAN_SEQ_MIN` para silenciar ruído.

Tenant Extension sozinha restaura o modelo pré-8B de isolamento só na app.

---

## 9. Validação

- Unit: `rls-context`, `rls-session`, Ops `SLOW_QUERY` / `FULL_TABLE_SCAN`
- E2E: fluxos tenant existentes (login, leads, webhook)
- `lint` / `build` / `test` / `test:e2e`

---

## 10. Não iniciado (aguardar aprovação)

- Outbound Worker
- Novas features de produto
