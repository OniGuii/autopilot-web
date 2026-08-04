# Fase 6A — Access Hardening Review

**Status:** Implementado (6A.1 — código sem migration)  
**Fase:** 6A — Access Hardening  
**Decisões:** AH1–AH10 aprovadas integralmente + **AH11 Membership Cache**  
**Fora de escopo:** Fase 6B (não iniciada)

---

## 1. Resumo executivo

A 6A fecha o buraco de autorização contínua: o access JWT deixa de ser a fonte de verdade de membership/role/company. Cada request autenticado revalida Session (DB), User, Membership e Company; membership/role/status usam Redis com TTL 30s (AH11). Logout-all, limite de 5 sessões, e reuse de refresh revogam sessão.

---

## 2. Fluxo final

```text
Access request
  Authorization: Bearer <accessJWT>
       │
       ▼
  JwtStrategy.validate
       │
       ▼
  AccessPrincipalService.resolveFromAccessToken
       │
       ├─ Session ALWAYS from Postgres
       │    • exists, not revoked, not expired, userId matches
       │    • User ACTIVE (from session.user)
       │    • JWT.cid/mid must match session bind (anti-stale)
       │
       ├─ Se session sem company → principal parcial (pré select-company)
       │
       └─ Se bound:
            Redis GET autopilot:auth:access:{userId}:{membershipId}
              HIT  → membership/role/userStatus/companyStatus
              MISS → Postgres Membership+Company+User → SET EX 30
            Fail-closed se Membership ≠ ACTIVE / Company ≠ ACTIVE / User ≠ ACTIVE
       │
       ▼
  AuthenticatedUser (sub,sid,mid,cid,role) → Guards / ALS

Refresh
  parse opaque token → verify hash
  se revoked/replaced → revokeSession(REFRESH_REUSE) → 401
  Session + User ACTIVE
  Membership revalidation (AccessPrincipal / cache)
  rotate refresh → new access

Login
  credentials → enforce max 5 sessions (revoke oldest) → create session

Logout-all
  JWT required → revoke all sessions + refresh → bust cache → audit (se cid)

Hooks (AuthRevocationService)
  onMembershipRevoked / onUserDisabled / onCompanySuspended
  → revoke sessions + invalidate Redis
```

---

## 3. Decisões AH1–AH11 (implementação)

| ID | Decisão | Implementação |
|---|---|---|
| AH1 | Revalidar membership/company no access | `AccessPrincipalService` em `JwtStrategy` |
| AH2 | Session/DB vence claims JWT | Anti-stale `cid`/`mid`; role do DB/cache |
| AH3 | Company SUSPENDED fail-closed + revoke | Check status + `onCompanySuspended` |
| AH4 | User DISABLED fail-closed | Session user check + `onUserDisabled` |
| AH5 | Sem JWT denylist | Session-bound revocation |
| AH6 | Max 5 sessions/user | `enforceSessionConcurrencyLimit` no login |
| AH7 | Refresh reuse → revoke session | `AuthService.refresh` + `revokeSession` |
| AH8 | Logout-all na 6A.1 | `POST /api/auth/logout-all` |
| AH9 | Sem migration nesta fase | 6A.1 código only |
| AH10 | Hooks admin (sem APIs admin) | `AuthRevocationService` exportado |
| **AH11** | Redis membership cache TTL 30s | Cache membership/role/user/company status |

---

## 4. Cache strategy (AH11)

| Item | Valor |
|---|---|
| Key | `autopilot:auth:access:{userId}:{membershipId\|none}` |
| TTL | **30 segundos** (`AUTH_MEMBERSHIP_CACHE_TTL_SECONDS`) |
| Payload | `userStatus`, `membershipId`, `membershipStatus`, `role`, `companyId`, `companyStatus` |
| Session | **Nunca** em cache — sempre Postgres |
| Negatives | Não cacheados (fail-closed sem polluir Redis) |
| Redis fail | Soft-fail → fallback DB (auth não depende de Redis up) |

### Invalidação

| Evento | Ação |
|---|---|
| `logout-all` | `DELETE` pattern `autopilot:auth:access:{userId}:*` |
| membership revoke | del key membership + pattern user |
| user disable | logout-all → pattern user |
| company suspend | pattern por users das sessions + del por memberships |
| select-company / logout | bust cache do user |

---

## 5. Novas queries / hot path

Por request autenticado **com** company bound:

1. `Session.findFirst` (+ `user`) — sempre  
2. Redis `GET` cache key  
3. Em miss: `Membership.findFirst` (+ `company`, `user`) + Redis `SET EX 30`

Refresh:

1. `RefreshToken.findFirst` (+ session/user/membership)  
2. Membership assert (cache/DB)  
3. Transaction create/update refresh rotation  

Login concurrency:

1. `Session.findMany` active ordered by `createdAt`  
2. `revokeSession` para overflow  

Logout-all:

1. `Session.updateMany` + `RefreshToken.updateMany`  
2. Redis SCAN/DEL pattern  
3. Audit opcional (requer `companyId`)

---

## 6. Impacto em performance

| Cenário | Antes | Depois |
|---|---|---|
| Access autenticado (bound) | 1 query session (+ user) | 1 query session + Redis GET; +1 membership query em miss (~30s) |
| Access sem company | 1 query | 1 query (inalterado estruturalmente) |
| Refresh | session/membership join | + assert membership (cache) |
| Redis down | N/A | Soft-fail; custo = DB membership a cada request |

**Esperado:** hit rate alta sob tráfego steady → membership DB quase eliminada no hot path; pior caso = +1 query leve por request se Redis cair.

---

## 7. Superfície de API

| Método | Path | Auth | Efeito |
|---|---|---|---|
| `POST` | `/api/auth/logout-all` | Bearer access | Revoga todas as sessions do user |
| (existente) | login / select-company / refresh / logout / me | — | Hardened internamente |

Config:

- `AUTH_MAX_SESSIONS_PER_USER` (default `5`)
- `AUTH_MEMBERSHIP_CACHE_TTL_SECONDS` (default `30`)

---

## 8. Arquivos principais

| Arquivo | Papel |
|---|---|
| `access-principal.service.ts` | Revalidação + cache AH11 |
| `auth-revocation.service.ts` | logout-all, reuse revoke, hooks, cache bust |
| `strategies/jwt.strategy.ts` | Delega ao principal resolver |
| `auth.service.ts` | concurrency, refresh reuse, logout-all, select-company bust |
| `auth.controller.ts` | `POST logout-all` |
| `auth.module.ts` | Providers + `AuditModule` |
| `shared/redis/redis.service.ts` | `get`/`set`/`del`/`deleteByPattern` soft-fail |
| `config/*` | max sessions + cache TTL |

---

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Residual até 30s se admin alterar status **sem** chamar hooks | Documentar: sempre usar `AuthRevocationService` hooks; TTL curto |
| SCAN Redis em invalidação sob muitos keys | Pattern por user; cardinality baixa |
| Audit logout-all sem `cid` (pré select-company) | Audit só quando `companyId` presente |
| Soft-fail Redis mascara outage | Logs warn; fallback DB |
| Membership.status ainda string livre | Aceito em 6A.1; enum fica para 6A.2 |
| Sem APIs admin disable/revoke nesta fase | Hooks prontos; produto admin = 6B+ |

---

## 10. Testes executados

### Unitários

| Suite | Cobertura |
|---|---|
| `access-principal.service.spec.ts` | cache hit/miss, revoke, suspend, disable, stale cid, pré-select |
| `auth-revocation.service.spec.ts` | logout-all, revokeSession, membership/user/company hooks |
| `auth.service.hardening.spec.ts` | max sessions, refresh reuse, logoutAll, refresh membership assert |

### E2E (`test/auth.e2e-spec.ts`)

- login → select-company → me  
- logout-all → access 401  
- refresh rotate + reuse → 401 e session morta  

### Build

- `npm run build` (apps/api)

---

## 11. Não iniciado

- **Fase 6B**  
- Migrations M1–M4 (6A.2)  
- APIs admin de disable/revoke/suspend UI  

---

## 12. Veredito

**6A.1 entregue:** revalidação contínua + logout-all + concurrency 5 + refresh reuse revoke + Redis membership cache (AH11). Pronto para review/merge; 6B não iniciada.
