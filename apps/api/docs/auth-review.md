# Auth Review — Identity & Access (MVP)

**Status:** Implementado  
**Branch:** `cursor/auth-implementation-dd93`  
**Base design:** `auth-design.md` (aprovado com ajustes)  
**Migration:** `20260802041000_auth_sessions`

---

## 1. Arquitetura final

```text
Cliente
  │
  ├─ POST /api/auth/login              (público)
  ├─ POST /api/auth/select-company     (Bearer access)
  ├─ POST /api/auth/refresh            (refresh opaco)
  ├─ POST /api/auth/logout             (refresh opaco)
  └─ GET  /api/auth/me                 (Bearer access)
           │
           ▼
     AuthController
           │
           ▼
     AuthService ── PrismaService ── PostgreSQL
           │              (sessions, refresh_tokens, users, memberships)
           │
           ├─ argon2  (passwordHash + refresh secret hash)
           └─ JwtService HS256 (access token)

Guards:
  JwtAuthGuard          → valida access JWT + sessão ativa
  CompanyContextGuard   → exige mid/cid/role (para rotas tenant futuras)

Prisma Tenant Extension: NÃO ativada globalmente.
OAuth: NÃO implementado.
```

### Princípios

1. **User global** → acesso a tenant só via **Membership ACTIVE**.
2. **Nunca** aceitar `companyId` do cliente como fonte de verdade; usar `companySlug` validado contra Membership.
3. Login cria **sessão sem company**; contexto tenant entra em `select-company`.
4. Access JWT é curto; refresh é opaco `id.secret` com **argon2** no secret e **rotação obrigatória**.

---

## 2. Tabelas criadas

### `sessions`

| Campo | Uso |
|---|---|
| `id` | claim JWT `sid` |
| `user_id` | dono da sessão |
| `membership_id` / `company_id` | preenchidos após select-company |
| `expires_at` | TTL (alinhado ao refresh, default 7d) |
| `revoked_at` | logout |
| `ip` / `user_agent` | telemetria leve |

### `refresh_tokens`

| Campo | Uso |
|---|---|
| `id` | parte pública do token (`id.secret`) |
| `token_hash` | argon2(secret) |
| `session_id` | binding à sessão |
| `user_id` / `membership_id` / `company_id` | auditoria / contexto |
| `expires_at` | TTL |
| `revoked_at` | logout / rotação |
| `replaced_by_id` | lineage da rotação |

Migration SQL: `prisma/migrations/20260802041000_auth_sessions/migration.sql`  
Schema Prisma: models `Session`, `RefreshToken` em `prisma/schema.prisma`.

---

## 3. Endpoints

| Método | Path | Auth | Comportamento |
|---|---|---|---|
| `POST` | `/api/auth/login` | público | Valida email/senha (argon2); cria session + refresh; access **sem** mid/cid/role |
| `POST` | `/api/auth/select-company` | Bearer | Valida Membership por `companySlug`; bind session; **rota refresh**; JWT completo |
| `POST` | `/api/auth/refresh` | body refresh | Verifica argon2; **revoga** atual; emite novo par; preserva contexto da session |
| `POST` | `/api/auth/logout` | body refresh | Revoga refresh ativos da session + session |
| `GET` | `/api/auth/me` | Bearer | User + memberships + claims atuais |

Prefixo global: `api` (exceto `/health*`).

---

## 4. JWT claims

| Claim | Conteúdo | Quando |
|---|---|---|
| `sub` | `userId` | sempre |
| `sid` | `sessionId` | sempre |
| `mid` | `membershipId` | após select-company |
| `cid` | `companyId` | após select-company |
| `role` | `OWNER` \| `ADMIN` \| `AGENT` | após select-company |

- Algoritmo: **HS256** (`JWT_ACCESS_SECRET`)
- TTL access: `JWT_ACCESS_TTL` (default `15m`)
- Refresh TTL: `JWT_REFRESH_TTL_DAYS` (default `7`)

---

## 5. Fluxos

### 5.1 Login → select-company → me

```text
1. POST /api/auth/login { email, password }
   → accessToken (sub,sid), refreshToken, memberships[], requiresCompanySelection=true

2. POST /api/auth/select-company { companySlug }
   Authorization: Bearer <access>
   → novos tokens com mid/cid/role; session.membershipId/companyId setados

3. GET /api/auth/me
   Authorization: Bearer <access>
   → user + company + membership + claims
```

### 5.2 Refresh (rotação obrigatória)

```text
POST /api/auth/refresh { refreshToken: "<id>.<secret>" }

1. Lookup por id
2. argon2.verify(token_hash, secret)
3. Validar session/user ativos
4. revoked_at no token atual + replaced_by_id = novo id
5. Criar novo refresh + novo access
6. Token antigo NÃO pode ser reutilizado
```

### 5.3 Logout

```text
POST /api/auth/logout { refreshToken }
→ revoga refresh tokens da session + session.revoked_at
```

---

## 6. Seeds / credenciais de demo

| Item | Valor |
|---|---|
| Senha seed (todos os users local/demo/test) | `Demo@12345` |
| Hash | argon2 em `upsertUser` |
| Exemplo email demo | `owner.concessionaria@demo.autopilot.dev` |
| Company slug | `demo-concessionaria` |

---

## 7. Exemplos de payload

### Login request

```json
{
  "email": "owner.concessionaria@demo.autopilot.dev",
  "password": "Demo@12345"
}
```

### Login response (resumo)

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<uuid>.<secret>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "requiresCompanySelection": true,
  "user": { "id": "...", "email": "...", "name": "..." },
  "memberships": [
    {
      "membershipId": "...",
      "companyId": "...",
      "companyName": "AutoPrime Veículos (Demo)",
      "companySlug": "demo-concessionaria",
      "role": "OWNER"
    }
  ],
  "sessionId": "..."
}
```

### Select-company request

```json
{
  "companySlug": "demo-concessionaria"
}
```

### Refresh / logout request

```json
{
  "refreshToken": "<uuid>.<secret>"
}
```

### Me response (após select-company)

```json
{
  "user": { "id": "...", "email": "...", "name": "...", "status": "ACTIVE" },
  "sessionId": "...",
  "company": { "id": "...", "name": "...", "slug": "demo-concessionaria" },
  "membership": { "id": "...", "role": "OWNER" },
  "memberships": [],
  "claims": {
    "sub": "...",
    "sid": "...",
    "mid": "...",
    "cid": "...",
    "role": "OWNER"
  }
}
```

---

## 8. Riscos e mitigações

| Risco | Severidade | Mitigação atual / gap |
|---|---|---|
| Reuso de refresh após rotação (theft) | Alta | Token antigo revogado; reuse falha com 401. Detecção de reuse family wipe = **não** no MVP |
| Access JWT comprometido até expirar | Média | TTL curto 15m; logout revoga session (próximas requests JWT falham via JwtStrategy) |
| Enumeração de emails | Baixa | Mensagens genéricas `Invalid credentials` |
| `companyId` spoofing | Alta | Cliente só envia `companySlug`; servidor valida Membership |
| Tenant Extension off | Aceito | Isolamento ainda depende de aplicação consciente em módulos futuros |
| Argon2 verify por id (O(1) lookup) | OK | Formato `id.secret` evita scan de hashes |
| Secrets JWT fracos em prod | Alta | Exigir `JWT_ACCESS_SECRET` forte em deploy |
| Sem rate-limit em login | Média | Fora do escopo Auth MVP — adicionar no gateway/API depois |
| OAuth ausente | Aceito | Fora do MVP |

---

## 9. Escopo explicitamente fora

- OAuth / social / magic link / 2FA  
- Reset/troca de senha  
- Convite de usuários via API  
- Ativação global Tenant/Soft-delete Prisma extensions  
- RBAC fino por endpoint  

---

## 10. Arquivos principais

```text
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/20260802041000_auth_sessions/
apps/api/src/modules/auth/
  auth.module.ts
  auth.controller.ts
  auth.service.ts
  dto/*
  guards/*
  strategies/jwt.strategy.ts
  types/jwt-payload.ts
apps/api/docs/auth-review.md
apps/api/docs/erd.md
apps/api/docs/database-model.md
```

---

## 11. Critérios de aceite (checklist)

- [x] Migration `sessions` + `refresh_tokens`
- [x] `schema.prisma` atualizado
- [x] ERD / database-model atualizados
- [x] Endpoints login / select-company / refresh / logout / me
- [x] Claims `sub|sid|mid|cid|role`
- [x] Argon2 senha + refresh
- [x] Rotação obrigatória de refresh
- [x] Sem OAuth
- [x] Sem Tenant Extension global
- [x] `docs/auth-review.md`
