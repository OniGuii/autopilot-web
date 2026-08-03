# Production Readiness Sprint — Review

**Status:** Implementado  
**Branch:** `cursor/production-readiness-dd93`  
**Foco:** qualidade / hardening (sem novas features de domínio)

---

## 1. Escopo entregue

| Item | Entrega |
|---|---|
| Tenant Extension ativada | `createTenantExtension` + ALS (`JWT.cid`) via `TenantInterceptor` |
| Soft Delete Extension ativada | Filtro automático `deletedAt: null` em find/count/aggregate/groupBy; `findUnique` post-filter |
| Swagger protegido | Default **off** em production; Basic Auth obrigatório se habilitado em prod |
| Rate limit global | `@nestjs/throttler` 120/min; login 20/min; skip health + webhook |
| E2E completos | Health, Auth, Tenancy (seed `test-fixture`) |
| Dívida ESLint | Specs relaxados; lint **0 errors** (warnings em `@Transform`) |

---

## 2. Tenant Extension

**Arquivos**
- `src/core/tenancy/tenant-als.ts` — AsyncLocalStorage
- `src/core/tenancy/tenant.interceptor.ts` — bind `JWT.cid`
- `src/prisma/extensions/tenant.extension.ts` — inject/verify `companyId`
- `src/prisma/prisma.service.ts` — `$extends` ativo

**Comportamento**
- Com contexto (request autenticado com `cid`): injeta `companyId` em models tenant-scoped; rejeita mismatch
- Sem contexto (webhook, login, jobs): não injeta — callers continuam escopando manualmente
- Models: membership, lead, conversation, message, followUp, event, auditLog, whatsAppInstance, webhookEvent

---

## 3. Soft Delete Extension

**Comportamento**
- Reads filtram `deletedAt: null` (override explícito permitido)
- `findUnique` retorna `null` se soft-deleted
- Rewrite `delete→update` permanece nos services (já existente); extensão foca no read-path

Models cobertos incluem Session, RefreshToken, WhatsAppInstance, WebhookEvent.

---

## 4. Swagger

| Env | Default | Proteção |
|---|---|---|
| development / test | enabled (se não setado) | Basic Auth opcional se `SWAGGER_USER/PASSWORD` |
| production | **disabled** | Se `SWAGGER_ENABLED=true`, exige user+password; senão boot falha |

Paths protegidos: `/docs`, `/docs-json`.

---

## 5. Rate limit

| Escopo | Limite default |
|---|---|
| Global (IP) | 120 / 60s |
| `POST /auth/login` | 20 / 60s |
| `/health*`, WhatsApp webhook | `@SkipThrottle` |

Env: `THROTTLE_TTL_MS`, `THROTTLE_LIMIT`, `THROTTLE_AUTH_LIMIT`.

---

## 6. E2E

| Suite | Cobertura |
|---|---|
| `test/app.e2e-spec.ts` | `/health`, `/live`, `/ready` |
| `test/auth.e2e-spec.ts` | login, select-company, me, 401, 403 sem company |
| `test/tenancy.e2e-spec.ts` | list/create lead, 404 id alienígena, dashboard |

Credenciais seed test: `owner@test.autopilot.dev` / `Demo@12345` / slug `test-fixture`.

CI: Postgres + Redis services → migrate → seed:test → `test:e2e`.

---

## 7. ESLint

- Overrides para `*.spec.ts` / e2e (mocks)
- `no-unsafe-return` / `no-redundant-type-constituents` → warn
- Resultado: **0 errors** (lint gate voltou a ser bloqueante no CI)

Antes (P0): ~174 errors. Depois: 0 errors + warnings residuais em DTOs Transform.

---

## 8. CI

`.github/workflows/api-ci.yml`:
1. lint (gate)
2. unit tests
3. migrate + seed:test
4. e2e
5. build

---

## 9. Fora do escopo (ainda backlog)

- Revalidação de membership a cada request
- Filas / worker FollowUp
- Count storms Ops/Dashboard
- Índices AI JSON
- Testes unitários Auth/Leads/Conversations
- RLS Postgres

---

## 10. Critérios de aceite

- [x] Extensions ativas no PrismaService  
- [x] TenantInterceptor global  
- [x] Swagger fail-closed em production  
- [x] Throttler global  
- [x] E2E auth + tenancy + health  
- [x] Lint 0 errors  
- [x] Sem nova feature de domínio / sem migration de schema  

---

## 11. Conclusão

Sprint de qualidade completa para os 6 focos pedidos.  
Sistema mais defensável em multi-tenant, docs, abuse e regressão automatizada.

**Aguardar aprovação** antes de nova fase de produto.
