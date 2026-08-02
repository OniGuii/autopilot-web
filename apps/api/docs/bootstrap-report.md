# Bootstrap Report — Ambiente Local AutoPilot

**Data (UTC):** 2026-08-02  
**Branch:** `cursor/local-bootstrap-dd93` (+ correções desta execução)  
**Objetivo:** Validar fundação completa (infra + migrations + seed demo + API)

---

## 1. Resumo executivo

| Etapa | Resultado |
|---|---|
| `npm install` | ✅ OK (~2s) |
| `npm run db:start` (Docker) | ❌ Docker ausente no ambiente |
| Infra alternativa (Postgres/Redis nativos) | ✅ OK |
| `npm run db:migrate` | ✅ M1 + M2 aplicadas (~1s) |
| `npm run db:seed:demo` | ✅ OK (~2s) |
| `npm run start:dev` | ✅ OK |
| `GET /health` | ✅ 200 |
| `GET /health/live` | ✅ 200 |
| `GET /health/ready` | ✅ 200 |
| `GET /docs` | ✅ 200 |
| Cross-tenant SQL check | ✅ 0 violações |

**Ambiente em funcionamento.** Auth e APIs de domínio **não** iniciados.

---

## 2. Tempo de execução

| Passo | Tempo aproximado |
|---|---|
| `npm install` | ~2s (deps já presentes) |
| Install Postgres/Redis (apt) | ~9s |
| Start Postgres/Redis + role/db | ~4s |
| `db:migrate` | ~1s |
| `db:seed:demo` | ~2s |
| `start:dev` até `/health` | < 2s (watch já/compilado) |
| **Total útil bootstrap** | **~20s** (excluindo apt se já instalado) |

---

## 3. Logs relevantes

### 3.1 `npm install`

- `postinstall` → `prisma generate` OK (Prisma Client v6.19.3)
- Warning: `package.json#prisma` deprecated (Prisma 7 futuro) — não bloqueante
- `npm audit`: 2 high (transitivas) — não tratado nesta etapa

### 3.2 `db:start` (primeira tentativa)

```text
> docker compose up -d postgres redis
sh: 1: docker: not found
```

### 3.3 Correção de infra

```text
apt-get install postgresql postgresql-contrib redis-server
pg_ctlcluster 16 main start
redis-server --daemonize yes
CREATE ROLE/DB autopilot
```

### 3.4 `db:migrate`

```text
Applying migration `20260801194800_init_mvp`
Applying migration `20260801194900_partial_uniques`
All migrations have been successfully applied.
Database schema is up to date!
```

Tabelas: `companies`, `users`, `memberships`, `leads`, `conversations`, `messages`, `follow_ups`, `events`, `audit_logs`  
Partial uniques: `uq_leads_*`, `uq_memberships_*`, `uq_conversations_*`, `uq_messages_*`

### 3.5 `db:seed:demo`

```json
{
  "profile": "demo",
  "counts": {
    "companies": 2,
    "users": 5,
    "memberships": 5,
    "leads": 200,
    "conversations": 200,
    "messages": 960,
    "followUps": 504,
    "events": 20,
    "auditLogs": 2
  }
}
```

Companies:
- `AutoPrime Veículos (Demo)` / `demo-concessionaria`
- `Oficina MotorMax (Demo)` / `demo-oficina`

Leads por status (agregado): NEW 34 · CONTACTED 34 · RESPONDED 34 · QUALIFIED 34 · CONVERTED 32 · LOST 32

### 3.6 Health / Docs

```json
GET /health       → 200 {"status":"ok","service":"autopilot-api",...}
GET /health/live  → 200 {"status":"ok","check":"live"}
GET /health/ready → 200 {"status":"ok","check":"ready"}
GET /docs         → 200 (Swagger UI HTML)
```

### 3.7 Integridade tenant (pós-seed)

```text
cross_tenant_conversations = 0
cross_tenant_messages      = 0
```

---

## 4. Migrations aplicadas

| Migration | Status |
|---|---|
| `20260801194800_init_mvp` | Applied |
| `20260801194900_partial_uniques` | Applied |

---

## 5. Quantidade de registros criados (seed demo)

| Tabela | Count |
|---|---|
| companies | 2 |
| users | 5 |
| memberships | 5 |
| leads | 200 |
| conversations | 200 |
| messages | 960 |
| follow_ups | 504 |
| events | 20 |
| audit_logs | 2 |

---

## 6. Erros encontrados

| # | Erro | Impacto | Resolução |
|---|---|---|---|
| E1 | `docker: not found` em `npm run db:start` | Bloqueou compose | Postgres 16 + Redis 7 instalados/nativos; role/db `autopilot` criados |
| E2 | `policy-rc.d` impediu start automático via apt | Serviços não subiram no install | Start manual (`pg_ctlcluster`, `redis-server --daemonize`) |

Nenhum erro em migrate, seed ou endpoints HTTP.

---

## 7. Correções realizadas

1. **Infra nativa** neste ambiente cloud (sem Docker).  
2. **Scripts resilientes:**
   - `scripts/db-start.sh` — Docker se disponível; senão Postgres/Redis nativos + ensure role/db  
   - `scripts/db-stop.sh` — para compose; no nativo apenas orienta  
3. `package.json`:
   - `db:start` → `bash scripts/db-start.sh`  
   - `db:stop` → `bash scripts/db-stop.sh`  

Domínio / schema / Auth / APIs: **não alterados**.

---

## 8. Endpoints validados

| Endpoint | HTTP | Body / nota |
|---|---|---|
| `/health` | 200 | `status=ok`, `service=autopilot-api` |
| `/health/live` | 200 | `check=live` |
| `/health/ready` | 200 | `check=ready` (ainda sem probe DB real) |
| `/docs` | 200 | Swagger UI |

API: `http://localhost:3001`

---

## 9. Limitações observadas

- `/health/ready` ainda não verifica Postgres/Redis (scaffold)  
- Prisma warning de depreciação `package.json#prisma`  
- Docker continua recomendado para dev padrão; fallback nativo cobre CI/cloud agents  
- Auth não iniciado (proposital)

---

## 10. Próximos passos sugeridos

1. Ativar probes reais em `/health/ready`  
2. Auth + TenantContext  
3. Ativar Prisma extensions (soft-delete → tenant)  
4. CRUDs de domínio sob guard rails  

---

**Bootstrap local concluído com sucesso.**
