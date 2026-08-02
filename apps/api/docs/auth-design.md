# Auth Design — Identity & Access (MVP)

**Status:** Design para aprovação (**sem implementação**)  
**Fase:** 2 — Identity & Access  
**Princípio:** menor solução possível para acessar o sistema com multi-tenancy seguro

Referências: `domain-decisions.md` (D7/D8/D10), `tenant-safety.md`, `schema.prisma`

---

## 1. Objetivo do MVP

Permitir que um usuário:

1. Faça login com e-mail/senha  
2. Obtenha tokens JWT (access + refresh)  
3. Tenha `companyId` + `role` resolvidos via **Membership**  
4. Consulte o contexto atual (`/auth/me`)  
5. Renove e encerre a sessão com segurança  

**Fora do MVP Auth:**
- OAuth / Social login  
- Magic link  
- 2FA  
- Convite de usuários (API)  
- Troca de senha / reset por e-mail  
- RBAC fino por endpoint além de role no token  
- Ativação global das Prisma extensions de tenant/soft-delete  

---

## 2. Atores e modelos

```text
User (global)
  └── Membership (companyId + userId + role + status)
        └── Company (tenant)
```

| Role (D7) | Uso no MVP |
|---|---|
| `OWNER` | Dono da operação |
| `ADMIN` | Gestor |
| `AGENT` | Vendedor / atendente |

Membership válida para login:

- `status = 'ACTIVE'`
- `deletedAt = null`
- Company `status = ACTIVE` e `deletedAt = null`
- User `status = ACTIVE` e `deletedAt = null`

---

## 3. Endpoints

| Método | Path | Auth | Descrição |
|---|---|---|---|
| `POST` | `/api/auth/login` | público | Login → access + refresh |
| `POST` | `/api/auth/refresh` | refresh token | Novo access (+ opcional rotate refresh) |
| `POST` | `/api/auth/logout` | refresh (ou access + refresh) | Revoga refresh |
| `GET` | `/api/auth/me` | access JWT | Usuário + company + membership atuais |

Prefixo global existente: `api` (exceto `/health*`).

---

## 4. Fluxo de login

```text
Cliente
  POST /api/auth/login
  { email, password, companySlug? }
        │
        ▼
AuthService
  1. Buscar User por email (deletedAt null)
  2. Se não existir / status ≠ ACTIVE → 401 genérico
  3. Verificar password com argon2.verify(passwordHash)
  4. Resolver Membership:
       - Se companySlug informado:
           achar Membership ACTIVE do user na Company(slug)
       - Senão:
           se exatamente 1 Membership ACTIVE → usar essa
           se 0 → 403 (sem tenant)
           se >1 → 400 pedindo companySlug
  5. Validar Company ACTIVE
  6. Emitir Access JWT (curto)
  7. Emitir Refresh Token (opaco ou JWT) + gravar HASH no DB
  8. Retornar tokens + contexto mínimo
```

### Request

```json
{
  "email": "owner.concessionaria@demo.autopilot.dev",
  "password": "***",
  "companySlug": "demo-concessionaria"
}
```

`companySlug` é **seletor de contexto**, não autorização.  
O servidor **sempre** valida Membership do `userId` autenticado.  
**Nunca** aceitar `companyId` cru do cliente como fonte de verdade.

### Response (200)

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<token>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": {
    "id": "...",
    "email": "...",
    "name": "..."
  },
  "company": {
    "id": "...",
    "name": "...",
    "slug": "..."
  },
  "membership": {
    "id": "...",
    "role": "OWNER"
  }
}
```

### Erros

| Caso | HTTP | Mensagem |
|---|---|---|
| Credenciais inválidas | 401 | `Invalid credentials` (genérico) |
| Sem membership ativa | 403 | `No active membership` |
| Múltiplas companies sem slug | 400 | `companySlug required` |
| Company/slug inválido para o user | 401/403 | genérico ou `Invalid company context` |

---

## 5. Estratégia JWT

### Access Token (JWT)

| Claim | Conteúdo |
|---|---|
| `sub` | `userId` |
| `sid` | `membershipId` |
| `cid` | `companyId` |
| `role` | `OWNER` \| `ADMIN` \| `AGENT` |
| `typ` | `access` |
| `iat` / `exp` | padrão JWT |

- Algoritmo: **HS256** (MVP) com `JWT_ACCESS_SECRET`  
- TTL sugerido: **15 minutos** (`JWT_ACCESS_TTL=15m`)  
- Transporte: `Authorization: Bearer <accessToken>`  
- **Não** armazenar access token no DB  

### Refresh Token

| Aspecto | Decisão MVP |
|---|---|
| Formato | String opaca aleatória (32+ bytes) **ou** JWT `typ=refresh` |
| Preferência | **Opaco** (mais fácil de revogar) |
| Armazenamento | Apenas **hash** (argon2 ou sha256) no DB |
| TTL sugerido | **7 dias** (`JWT_REFRESH_TTL=7d`) |
| Rotação | Sim no refresh: invalida o anterior, emite novo |
| Binding | `userId` + `membershipId` + `companyId` |

### Tabela nova necessária: `refresh_tokens`

O schema atual **não** tem onde guardar refresh hash.  
Proposta mínima (sujeita a aprovação):

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK users |
| `membership_id` | UUID | FK memberships |
| `company_id` | UUID | FK companies (denormalizado p/ auditoria) |
| `token_hash` | string | unique |
| `expires_at` | datetime | |
| `revoked_at` | datetime? | logout / rotate |
| `created_at` / `updated_at` / `deleted_at` | datetime | padrão soft delete |

Índices: `token_hash` unique; `(user_id, company_id)`; `expires_at`.

> Sem esta tabela (ou equivalente), logout/refresh seguros **não** são viáveis.

---

## 6. Fluxo de refresh

```text
POST /api/auth/refresh
{ "refreshToken": "..." }

1. Hash do token recebido
2. Buscar refresh_tokens por token_hash
   - não encontrado / revoked / expired → 401
3. Validar User + Membership + Company ainda ACTIVE
4. Revogar token atual (revoked_at = now)  // rotação
5. Emitir novo access JWT
6. Emitir novo refresh + salvar hash
7. Retornar tokens
```

Se Membership foi revogada entre logins → refresh falha (403/401).

---

## 7. Fluxo de logout

```text
POST /api/auth/logout
{ "refreshToken": "..." }
// opcionalmente Authorization access (não obrigatório no MVP)

1. Hash refreshToken
2. Se existir sessão: revoked_at = now
3. Resposta 204/200 mesmo se token inválido (não enumerar)
```

MVP **não** mantém denylist de access tokens (TTL curto basta).  
Logout efetivo para novas emissões = refresh revogado.

---

## 8. Fluxo `/auth/me`

```text
GET /api/auth/me
Authorization: Bearer <access>

1. JwtAuthGuard valida access
2. Carrega User + Membership(sid) + Company(cid)
3. Revalida ACTIVE / deletedAt
4. Retorna user, company, membership.role
```

Se membership inválida → 401 (forçar re-login).

---

## 9. Estratégia Membership / Multi-tenancy

### Resolução de `companyId`

| Fonte | Permitido? |
|---|---|
| Membership ACTIVE do user autenticado | ✅ única fonte |
| Claim `cid` do access JWT (após validação server-side) | ✅ para request atual |
| Body/query/header `companyId` do cliente | ❌ nunca como verdade |
| `companySlug` no login | ✅ só como seletor, validado contra Membership |

### Guards (implementação futura desta fase)

| Guard | Função |
|---|---|
| `JwtAuthGuard` | Exige access JWT válido |
| `RolesGuard` (opcional MVP) | `@Roles('OWNER','ADMIN')` quando necessário |
| Preencher `TenantContext` | `companyId`, `userId`, `role`, `membershipId` a partir do JWT |

Prisma extensions **permanecem desativadas** nesta fase.  
Serviços devem filtrar por `companyId` do contexto (não do client).

---

## 10. Segurança — hashing e segredos

| Item | Escolha MVP |
|---|---|
| Password | **argon2id** via `argon2` (Node) |
| Refresh token at rest | hash (**sha256** rápido ok para tokens opacos de alta entropia; ou argon2) |
| Access JWT secret | `JWT_ACCESS_SECRET` (env, longo) |
| Refresh secret (se JWT) | `JWT_REFRESH_SECRET` separado |
| Timing | resposta de login uniforme em falha de user/senha |

### Env novos (propostos)

```env
JWT_ACCESS_SECRET=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
# opcional se refresh for JWT:
JWT_REFRESH_SECRET=
```

### Seeds

Hoje `passwordHash = null`. Na implementação:

- Definir senha fake documentada só para local/demo (ex. em `seed-review`)  
- Hash argon2 no seed  
- **Nunca** usar senha de seed em produção  

---

## 11. Módulos Nest (planejamento de código — não criar agora)

```text
modules/auth/
  auth.module.ts
  auth.controller.ts
  auth.service.ts
  dto/
  strategies/jwt.strategy.ts
  guards/jwt-auth.guard.ts

# suporte
prisma model RefreshToken (+ migration)
core/tenancy: preencher TenantContext a partir do JWT
```

Dependências previstas: `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `argon2`.

---

## 12. Riscos de segurança

| ID | Risco | Severidade | Mitigação |
|---|---|---|---|
| S1 | Cliente envia `companyId` e backend confia | **Crítica** | Ignorar; só Membership |
| S2 | Refresh token roubado | Alta | Hash at rest, TTL, rotação, logout |
| S3 | Access token roubado | Média | TTL curto; HTTPS |
| S4 | Enumeração de e-mails | Média | Erro genérico no login |
| S5 | User sem membership acessa API | Alta | Bloquear login/refresh/me |
| S6 | Role alterada no DB, token antigo | Média | TTL access curto; `/me` e refresh revalidam |
| S7 | JWT secret fraco | Crítica | Secret longo em env; nunca commit |
| S8 | Refresh reuse após rotate (roubo) | Alta | Detect reuse → revogar família (opcional MVP+) |
| S9 | Soft-deleted user ainda loga | Alta | Checar `deletedAt`/`status` sempre |
| S10 | Seed passwords em prod | Alta | Bloquear seed prod; senhas só local/demo |

---

## 13. Decisões que precisam de aprovação explícita

1. **Tabela `refresh_tokens`** — criar model + migration? (**recomendado: sim**)  
2. **Refresh opaco vs JWT** — recomendado: **opaco**  
3. **Rotação de refresh** no `/refresh` — recomendado: **sim**  
4. **Seleção de company** — `companySlug` opcional com regra 0/1/N memberships  
5. **TTL** — access 15m / refresh 7d  
6. **Algoritmo password** — argon2id  
7. **Hash do refresh** — sha256 (token opaco) ou argon2  
8. **Path** — sob `/api/auth/*` (prefixo global)  

---

## 14. Critério de pronto da Fase 2 (após aprovação + implementação)

- [ ] Login/refresh/logout/me funcionando  
- [ ] Password argon2  
- [ ] Refresh persistido como hash + revogável  
- [ ] `companyId` só via Membership  
- [ ] Seeds locais com senha fake  
- [ ] Testes unitários mínimos do AuthService  
- [ ] Swagger documentando os 4 endpoints  
- [ ] Sem ativar tenant/soft-delete extensions globais  

---

## 15. Fora desta etapa

- Código Nest/Prisma  
- Migration  
- Auth real  
- Controllers além do design  

---

**Aguardar aprovação deste design (e das decisões §13) antes de implementar.**
