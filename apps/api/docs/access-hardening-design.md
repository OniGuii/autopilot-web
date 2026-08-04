# Fase 6A — Access Hardening Design

**Status:** Design para aprovação (**sem implementação**)  
**Fase:** 6A — Access Hardening  
**Origem:** `architecture-audit.md` (R1, R2, R11, R19) + gaps do Auth MVP  
**Pré-requisitos:** Auth MVP, Tenant Extension, Soft Delete Extension, Production Readiness  
**Restrições desta etapa de design:**
- **Sem código**
- **Sem migrations aplicadas**
- **Sem alteração de schema nesta entrega**
- Migrations propostas apenas como plano (implementação futura)

---

## 1. Objetivo

Fechar o buraco de autorização contínua: hoje o access JWT carrega `mid` / `cid` / `role` e o `JwtStrategy` **não revalida** Membership/Company a cada request. Isso permite acesso residual após revoke, soft-delete, disable ou suspensão até o TTL do access token (e o refresh pode reemitir claims fracos).

```text
Hoje (gap):
  JWT.cid/role confiados → CompanyContextGuard só checa presença → tenant ALS

6A (alvo):
  JWT válido + Session viva
    → User ACTIVE
    → (se cid) Membership ACTIVE + Company ACTIVE
    → claims alinhados à sessão/DB
    → só então ALS / RolesGuard
```

### 1.1 Dentro do escopo 6A

| Tema | Entrega de design |
|---|---|
| Membership revogada | Fail-closed imediato (access + refresh) |
| Membership soft-deleted | Idem |
| User disabled / soft-deleted | Fail-closed global |
| Company suspended / closed / soft-deleted | Fail-closed no tenant |
| Session invalidation | Modelo + APIs |
| JWT revocation strategy | Session-bound (sem denylist JWT) |
| Refresh token revocation | Sessão, usuário, família, reuse |
| Logout all devices | Endpoint + regras |
| Session concurrency limits | Política + enforcement no login |

### 1.2 Fora do escopo 6A

- OAuth / 2FA / magic link  
- Convite de usuários (produto)  
- RBAC fino por permissão além de `OWNER|ADMIN|AGENT`  
- RLS Postgres  
- Filas / WhatsApp / AI  
- Frontend  
- Implementação de código nesta etapa  

---

## 2. Estado atual (baseline)

### 2.1 O que já existe (bom)

| Capacidade | Onde |
|---|---|
| Access JWT curto (`sub`, `sid`, `mid?`, `cid?`, `role?`) | `JwtPayload` |
| Session com `revokedAt` / `expiresAt` | `Session` |
| Refresh opaco `id.secret` + argon2 + rotação | `RefreshToken` |
| Logout revoga refresh da sessão + session | `AuthService.logout` |
| Login/select-company filtram Membership ACTIVE + Company ACTIVE | `AuthService` |
| JwtStrategy valida session + User ACTIVE | `jwt.strategy.ts` |
| Soft-delete extension filtra `deletedAt` em reads | Prisma |

### 2.2 Gaps que a 6A fecha

| Gap | Efeito |
|---|---|
| JwtStrategy **não** carrega Membership/Company | Membership REVOKED / soft-deleted / role alterada permanece válida no access até TTL |
| Claims JWT preferidos sobre session (`payload.mid ?? session…`) | Token antigo pós `select-company` pode apontar company A enquanto session já é B |
| Refresh usa `session.membership` sem checar `status` / Company | Pode reemitir access para membership inválida |
| Sem logout-all / logout-other-sessions | Não há “expulsar todos os devices” |
| Sem limite de sessões concorrentes | Login cria session sem teto |
| Refresh reuse não revoga família | Token roubado + rotação parcial |
| Auth lifecycle sem auditoria | Forense fraca |
| Membership.status é `String` livre | Sem enum Prisma; estados pouco formalizados |

---

## 3. Princípios de autorização (6A)

1. **Fail-closed:** dúvida → 401/403; nunca permitir.  
2. **Session é a fonte de revogação do access:** JWT stateless + check de `Session` a cada request autenticado (já parcial).  
3. **Membership/Company são fonte de verdade do tenant:** nunca confiar só em claims JWT para autorização de negócio.  
4. **Access TTL curto permanece** (ex. 15m); hardening não exige denylist JWT se session+membership forem checados.  
5. **Refresh é o único path longo:** deve revalidar User + Session + Membership + Company antes de emitir access.  
6. **Tenant ALS só após principal válido:** interceptor continua, mas `cid` vem do principal resolvido (DB), não de claim cego.  
7. **Mensagens genéricas em login** (anti-enumeration); erros internos de revoke podem ser específicos para cliente autenticado.

---

## 4. Modelo de estados

### 4.1 User

| Status / flag | Login | Access (qualquer) | Refresh |
|---|---|---|---|
| `ACTIVE`, `deletedAt=null` | ✅ | ✅ | ✅ |
| `DISABLED` | ❌ 401 | ❌ 401 + revoke sessions | ❌ |
| `PENDING` | ❌ 401 | ❌ | ❌ |
| `deletedAt != null` | ❌ | ❌ | ❌ |

**Ação ao disabled/soft-delete (evento de admin futuro ou script):** revogar **todas** as sessions + refresh do user.

### 4.2 Company

| Status / flag | select-company | Access com cid | Refresh com company |
|---|---|---|---|
| `ACTIVE`, `deletedAt=null` | ✅ | ✅ | ✅ |
| `SUSPENDED` | ❌ 403 | ❌ 403 | ❌ (clear company context ou 401) |
| `CLOSED` | ❌ 403 | ❌ 403 | ❌ |
| `deletedAt != null` | ❌ | ❌ | ❌ |

**Ação ao suspender company:** revogar sessions **com `companyId` dessa company** (ou clear bind + forçar re-select). Recomendação 6A: **revoke sessions bound** à company (mais seguro).

### 4.3 Membership

Estados lógicos (hoje `status` string; ver §10 migrations):

| Estado | Significado | Access tenant | Refresh |
|---|---|---|---|
| `INVITED` | Ainda não entrou | ❌ | ❌ |
| `ACTIVE` | Válida | ✅ | ✅ |
| `REVOKED` | Removida pelo admin | ❌ | ❌ |
| Soft-deleted (`deletedAt`) | Remoção lógica | ❌ | ❌ |

**Ação ao REVOKED / soft-delete:**  
1. Revogar sessions com `membershipId` correspondente  
2. Revogar refresh tokens ligados  
3. Access ainda em TTL falha no **próximo request** via revalidação (não espera expirar JWT)

### 4.4 Session

| Estado | Condição | Efeito |
|---|---|---|
| Active | `revokedAt=null`, `expiresAt>now`, `deletedAt=null` | Access/refresh ok (se User/Membership ok) |
| Expired | `expiresAt<=now` | 401 |
| Revoked | `revokedAt!=null` | 401 (JWT “revogado”) |
| Soft-deleted | `deletedAt!=null` | 401 |

Campos lógicos novos (propostos, não implementar agora): ver §10.

### 4.5 RefreshToken

| Estado | Efeito |
|---|---|
| Active | Pode rotacionar |
| Revoked (`revokedAt`) | 401 |
| Expired | 401 |
| Replaced (`replacedById`) | 401; se **reuso** detectado → revoke família/sessão |

---

## 5. Regras de autorização (contrato 6A)

### 5.1 Request autenticado (access JWT)

Pipeline proposto:

```text
1. JwtAuthGuard (Passport) — assinatura + exp JWT
2. JwtStrategy.validate / AccessPrincipalResolver:
   a. Carregar Session por sid+sub (não revoked/expired/deleted)
   b. Carregar User (ACTIVE, not deleted)
   c. Se session.companyId OU payload.cid presente:
        - Resolver Membership por session.membershipId (preferido) ou mid
        - Exigir membership.userId = sub
        - Exigir membership.status = ACTIVE, deletedAt null
        - Exigir company.status = ACTIVE, deletedAt null
        - role efetiva = membership.role (DB), NÃO payload.role cego
   d. Alinhar AuthenticatedUser:
        sub, sid, mid, cid, role ← DB/session (não claim stale)
3. CompanyContextGuard — exige mid+cid+role no principal já resolvido
4. RolesGuard — usa role do principal
5. TenantInterceptor — ALS companyId = principal.cid (já validado)
```

**Regra anti-stale-company:** se `payload.cid` ≠ `session.companyId` (quando session já bound), **vencer session.companyId**; se payload.cid sem session.companyId, exigir select-company ou 401.

### 5.2 Matriz de decisão rápida

| Condição | HTTP | Side-effect |
|---|---|---|
| JWT inválido/expirado | 401 | — |
| Session revoked/expired | 401 | — |
| User DISABLED/deleted | 401 | revoke all sessions (best-effort) |
| Company context required mas ausente | 403 | — |
| Membership REVOKED/deleted | 401 ou 403* | revoke sessions da membership |
| Company SUSPENDED/CLOSED/deleted | 403 | revoke sessions da company |
| Role insuficiente | 403 | — |

\*Recomendação: **401** quando credencial/contexto de auth inválido; **403** quando autenticado mas sem permissão de tenant/role. Membership revogada → **401** + clear client (forçar re-login/select).

### 5.3 Rotas sem company context

| Rota | Checagens 6A |
|---|---|
| `POST /auth/login` | User ACTIVE only |
| `POST /auth/select-company` | Session+User; Membership+Company ACTIVE |
| `POST /auth/refresh` | Ver §8 |
| `POST /auth/logout` | Refresh válido → revoke session |
| `POST /auth/logout-all` (novo) | Access ou refresh → revoke all user sessions |
| `GET /auth/me` | Session+User; se bound, Membership+Company |

Webhook WhatsApp **não** usa JWT — fora do pipeline 6A (continua secret + instance).

---

## 6. Estratégias detalhadas

### 6.1 Membership revogada

**Trigger (futuro admin API ou ops):** `membership.status = REVOKED`.

**Efeitos imediatos (serviço de revoke):**
1. `UPDATE memberships SET status='REVOKED'`  
2. `Session` com `membershipId` → `revokedAt=now`  
3. `RefreshToken` dessas sessions → `revokedAt=now`  
4. Audit: `MEMBERSHIP_REVOKED`, `SESSION_REVOKED_BULK`

**Efeito em voo:** próximo access com JWT antigo falha na revalidação de membership (mesmo se session ainda não foi tocada — defesa em profundidade). Preferir **também** revogar session para falhar cedo no check de session.

### 6.2 Membership soft-deleted

Igual a revogada: soft-delete extension já esconde em `findFirst` se `deletedAt` setado → membership “não encontrada” → 401.  
Ainda assim: revogar sessions ligadas explicitamente (não depender só do filtro).

### 6.3 User disabled

**Trigger:** `user.status = DISABLED` (ou soft-delete).

**Efeitos:**
1. Revogar **todas** sessions do user  
2. Revogar **todos** refresh tokens do user  
3. Login passa a retornar 401 genérico  
4. Audit: `USER_DISABLED`, `AUTH_LOGOUT_ALL`

JwtStrategy já rejeita user ≠ ACTIVE; 6A adiciona **cascata de revoke** no momento do disable (não só fail no próximo request).

### 6.4 Company suspended

**Trigger:** `company.status = SUSPENDED` (ou `CLOSED`).

**Efeitos:**
1. Revogar sessions com `companyId = X`  
2. Revogar refresh dessas sessions  
3. `select-company` para slug da company → 403  
4. Memberships ACTIVE permanecem no DB (podem reativar com company) — mas **sem session bound**  
5. Audit: `COMPANY_SUSPENDED`, `SESSION_REVOKED_BULK`

**Alternativa rejeitada (6A):** manter session e só falhar no guard — pior UX e janela maior; revoke é preferido.

### 6.5 Session invalidation

| Operação | Escopo |
|---|---|
| Logout (atual) | 1 session (+ seus refresh) |
| Logout all devices (novo) | Todas sessions do user |
| Logout others (opcional 6A stretch) | Todas exceto `sid` atual |
| Revoke on membership/company/user event | Subconjunto afetado |
| Max sessions (concurrency) | Ao login, revogar as mais antigas além do limite |

Session continua sendo o **kill switch** do access JWT.

### 6.6 JWT revocation strategy

**Escolha 6A: Session-bound revocation (já parcialmente implementada).**

| Opção | Decisão |
|---|---|
| Denylist JWT em Redis | **Não** no 6A (complexidade; access já curto) |
| Version claim `ver` no User | Opcional futuro; não necessário se session+membership checados |
| Reduzir access TTL (ex. 5m) | **Recomendado** como config (`JWT_ACCESS_TTL`), não obrigatório mudar default nesta fase |

**Contrato:** access é válido só se assinatura ok **e** session ativa **e** (se tenant) membership/company ativas. Isso é revogação efetiva sem denylist.

### 6.7 Refresh token revocation

| Cenário | Comportamento 6A |
|---|---|
| Logout | Revoga todos refresh da session + session (já existe) |
| Logout all | Revoga todos refresh do user + todas sessions |
| Membership/company revoke | Revoga refresh das sessions afetadas |
| Refresh rotation | Mantém; `replacedById` |
| **Reuse detection** | Se refresh já `revokedAt`/`replacedById` for apresentado de novo → **revoke session inteira** (+ opcional todas sessions do user) |

Campo opcional `familyId` (migration futura) facilita revoke em árvore; MVP de reuse pode revogar por `sessionId` sem `familyId`.

### 6.8 Logout all devices

**Endpoint proposto:**

```http
POST /api/auth/logout-all
Authorization: Bearer <access>
```

Ou body com refresh (para clientes sem access). Preferência: **access JWT** (user autenticado).

**Efeito:**
```text
UPDATE sessions SET revokedAt=now WHERE userId=:sub AND revokedAt IS NULL
UPDATE refresh_tokens SET revokedAt=now WHERE userId=:sub AND revokedAt IS NULL
Audit AUTH_LOGOUT_ALL
```

Resposta: `{ ok: true, revokedSessions: N }`.

### 6.9 Session concurrency limits

| Parâmetro | Default proposto | Env |
|---|---|---|
| Máx. sessions ativas por user | **5** | `AUTH_MAX_SESSIONS_PER_USER` |
| Política ao exceder | Revogar as **mais antigas** (`createdAt` ASC) até caber a nova | — |
| Escopo | Por `userId` (global), não por company | Simples no MVP |

**No login (após autenticar user):**
1. Contar sessions ativas (`revokedAt null`, `expiresAt > now`, `deletedAt null`)  
2. Se `count >= MAX`, revogar as mais antigas (`count - MAX + 1`)  
3. Criar nova session  

**Stretch (não obrigatório 6A):** limite por `(userId, companyId)` após select-company.

---

## 7. Fluxos

### 7.1 Access request (happy path)

```text
Cliente → Authorization: Bearer access
  → JwtAuthGuard
  → JwtStrategy / AccessPrincipalResolver
       Session OK + User ACTIVE
       Membership ACTIVE + Company ACTIVE (se bound)
       role ← DB
  → CompanyContextGuard / RolesGuard
  → TenantInterceptor (ALS cid)
  → Handler
```

### 7.2 Membership revogada durante sessão

```text
t0: user com access (cid=A, mid=M)
t1: admin revoga M → sessions(M) revoked + refresh revoked
t2: request com access antigo
    → Session revoked OU Membership not ACTIVE → 401
t3: refresh antigo → 401
t4: login + select-company A → 403 (sem membership)
```

### 7.3 Company suspended

```text
t0: sessions bound company C
t1: C.status = SUSPENDED → revoke sessions(companyId=C)
t2: access/refresh → 401
t3: select-company C → 403
t4: user ainda pode select-company em outra company ACTIVE
```

### 7.4 User disabled

```text
t0: N devices com sessions
t1: user.status = DISABLED → logout-all implícito
t2: qualquer access/refresh → 401
t3: login → 401 genérico
```

### 7.5 Refresh com revalidação (6A)

```text
POST /auth/refresh { refreshToken }
  1. Parse + load RefreshToken
  2. Se já revoked/replaced → REUSE PATH → revoke session (+ audit) → 401
  3. Verify argon2
  4. Session active?
  5. User ACTIVE?
  6. Se session.membershipId:
       Membership ACTIVE + not deleted?
       Company ACTIVE + not deleted?
       role = membership.role
     Senão: access sem company (requiresCompanySelection=true)
  7. Rotate refresh
  8. Emit access com claims do DB
```

### 7.6 Logout all devices

```text
POST /auth/logout-all (access)
  → resolve user
  → revoke all sessions + refresh
  → audit AUTH_LOGOUT_ALL
  → 200 { ok: true }
```

### 7.7 Concurrency no login

```text
login OK
  → list active sessions order by createdAt ASC
  → while count >= MAX: revoke oldest
  → create session + issue tokens
```

---

## 8. Casos de uso

| ID | Caso | Resultado esperado |
|---|---|---|
| UC1 | Agent ativo em company A | Access normal |
| UC2 | Membership REVOKED | Próximo API call 401; refresh 401 |
| UC3 | Membership soft-deleted | Idem UC2 |
| UC4 | Role AGENT→ADMIN (ou inverso) | Próximo request usa role DB (não claim antigo) |
| UC5 | User DISABLED | Todas sessions mortas; login bloqueado |
| UC6 | Company SUSPENDED | Sessions da company mortas; outras companies ok |
| UC7 | select-company A depois token antigo de B | Token B rejeitado ou forçado a session.cid=A (session wins) |
| UC8 | Logout | Só device/session atual |
| UC9 | Logout all | Todos devices |
| UC10 | 6º login com MAX=5 | Session mais antiga revogada |
| UC11 | Refresh token reuse após rotate | Session revogada; 401 |
| UC12 | Webhook WhatsApp | Sem mudança (não JWT) |

---

## 9. Impactos

### 9.1 Impacto no Auth atual

| Peça | Mudança proposta (futura implementação) |
|---|---|
| `JwtStrategy.validate` | Expandir para Membership+Company; **role/cid/mid do DB** |
| `AuthService.refresh` | Checar membership.status + company.status; reuse detection |
| `AuthService.login` | Enforcement `AUTH_MAX_SESSIONS_PER_USER` |
| `AuthService.selectCompany` | Mantém filtros; opcional revoke sessions de outras companies do user (não obrigatório) |
| `AuthController` | Novos: `POST logout-all`; opcional `POST logout-others` |
| Audits | `AUTH_LOGIN`, `AUTH_LOGOUT`, `AUTH_LOGOUT_ALL`, `AUTH_REFRESH_REUSE`, `AUTH_SESSION_REVOKED`, `MEMBERSHIP_REVOKED` (quando houver API) |
| DTOs | Nenhum breaking change nos tokens existentes |

**Compatibilidade:** clientes atuais continuam; tokens emitidos antes da 6A passam a falhar mais cedo se membership inválida (desejável).

### 9.2 Impacto nas tenant extensions

| Aspecto | Impacto |
|---|---|
| ALS `companyId` | Continua preenchido pelo interceptor |
| Fonte do cid | Deve ser **principal resolvido** (já validado), não claim stale |
| Extension enforce | Sem mudança de contrato; beneficia-se de cid correto |
| Webhook (ALS vazio) | Sem mudança |

**Regra:** TenantInterceptor lê `request.user.cid` **após** JwtStrategy — se strategy só setar cid válido, extension fica segura.

### 9.3 Impacto nos guards

| Guard | Impacto |
|---|---|
| `JwtAuthGuard` | Sem mudança de API |
| `CompanyContextGuard` | Continua checando presença; pode assumir que cid já é válido (defesa secundária) |
| `RolesGuard` | Usa `user.role` já vindo do DB — demote/promote reflete no próximo request |
| `TenantGuard` (core) | Alinhar mensagem/comportamento com CompanyContextGuard (evitar duplicidade) |

Opcional 6A: fundir checagem pesada só na Strategy e manter guards “baratos”.

### 9.4 Impacto no refresh flow

| Hoje | 6A |
|---|---|
| Checa session + user | + Membership ACTIVE + Company ACTIVE |
| Emite role de `session.membership` sem status | Emite só se membership válida |
| Reuse → 401 simples | Reuse → revoke session (+ audit) → 401 |
| Rotação obrigatória | Mantém |

---

## 10. Migrations necessárias (plano — **não aplicar agora**)

> Esta seção é **especificação futura**. Fase 6A design **não** cria migration nem altera schema.

### 10.1 Obrigatórias para implementação limpa (recomendadas)

| ID | Mudança | Motivo |
|---|---|---|
| M1 | Enum Prisma `MembershipStatus` (`INVITED`, `ACTIVE`, `REVOKED`) + migrate coluna `memberships.status` | Estados formais; evita strings soltas |
| M2 | Índice `(user_id, revoked_at, expires_at)` em `sessions` | Contagem/concurrency + logout-all |
| M3 | Índice `(membership_id, revoked_at)` em `sessions` | Revoke por membership |
| M4 | Índice `(company_id, revoked_at)` em `sessions` | Revoke por company suspend |

### 10.2 Opcionais (nice-to-have)

| ID | Mudança | Motivo |
|---|---|---|
| M5 | `sessions.revoke_reason` `VARCHAR(64)` nullable | Forense (`LOGOUT`, `LOGOUT_ALL`, `MEMBERSHIP_REVOKED`, `COMPANY_SUSPENDED`, `USER_DISABLED`, `MAX_SESSIONS`, `REFRESH_REUSE`) |
| M6 | `sessions.last_seen_at` | Concurrency “idle” / UX devices |
| M7 | `refresh_tokens.family_id` UUID | Revoke em árvore de rotação |
| M8 | `users.token_version` Int | Kill switch global alternativo (não necessário se session check completo) |

### 10.3 Implementação sem migration (caminho mínimo)

É possível entregar **maior parte da 6A sem M1–M8**:

- Revalidar `membership.status === 'ACTIVE'` (string) + `deletedAt`  
- Revalidar company status  
- Logout-all / concurrency / reuse com campos **já existentes** (`revokedAt`)

**Recomendação de produto:**  
- **6A.1** implementação sem schema (só código)  
- **6A.2** migrations M1–M4 (+ M5) na sequência, se aprovado  

Este design cobre ambos; aprovação deve escolher 6A.1 vs 6A.1+6A.2.

---

## 11. Endpoints (proposta de contrato)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| existentes | login / select-company / refresh / logout / me | — | Comportamento endurecido |
| `POST` | `/api/auth/logout-all` | access | Revoga todas sessions do user |
| `POST` | `/api/auth/logout-others` | access | Stretch: revoga outras sessions |

**Não** expor nesta fase APIs admin de “disable user / revoke membership” (pode ser Fase 6A.3 ou módulo Users); design assume **hooks internos** `AuthRevocationService` chamáveis por admin futuro.

---

## 12. Auditoria (proposta)

| Action | Quando |
|---|---|
| `AUTH_LOGIN` | Login ok |
| `AUTH_LOGIN_FAILED` | Credencial inválida (sem PII excessivo) |
| `AUTH_SELECT_COMPANY` | Bind ok |
| `AUTH_REFRESH` | Rotate ok |
| `AUTH_REFRESH_REUSE` | Reuse detectado |
| `AUTH_LOGOUT` | Logout session |
| `AUTH_LOGOUT_ALL` | Logout all devices |
| `AUTH_SESSION_REVOKED` | Revoke por política (max sessions, etc.) |
| `MEMBERSHIP_REVOKED` | Quando API/admin existir |
| `COMPANY_SUSPENDED` | Quando API/admin existir |
| `USER_DISABLED` | Quando API/admin existir |

---

## 13. Estratégia de rollout

### 13.1 Fases de entrega (após aprovação do design)

| Step | Conteúdo | Risco |
|---|---|---|
| **6A.1** | Revalidação Membership/Company no JwtStrategy + refresh; role/cid do DB; anti-stale cid | Baixo–médio |
| **6A.1b** | Refresh reuse → revoke session; logout-all; max sessions | Baixo |
| **6A.1c** | Audits auth | Baixo |
| **6A.2** | Migrations M1–M4 (+ M5) se aprovado | Médio (migrate) |
| **6A.3** | Admin hooks/APIs disable/revoke/suspend (opcional) | Produto |

### 13.2 Feature flags (recomendado)

| Flag | Default |
|---|---|
| `AUTH_ENFORCE_MEMBERSHIP_ON_ACCESS=true` | on em staging/prod |
| `AUTH_MAX_SESSIONS_PER_USER=5` | 5 |
| `AUTH_REFRESH_REUSE_REVOKES_SESSION=true` | on |
| `AUTH_ACCESS_TTL` | manter `15m` ou reduzir para `5m` em prod |

### 13.3 Ordem de deploy

1. Deploy código 6A.1 com flag on (staging)  
2. E2E: revoke membership mid-session; company suspend; logout-all; max sessions  
3. Produção controlada  
4. Só então migrations 6A.2 se necessário  

### 13.4 Rollback

- Flags off: volta a confiar mais em claims (não ideal — preferir hotfix)  
- Logout-all/max sessions são aditivos — rollback = desligar endpoints/limites  
- Migrations 6A.2: expand/contract; enum MembershipStatus exige cuidado

### 13.5 Testes de aceite (futura implementação)

- [ ] Membership REVOKED → access 401 no próximo request  
- [ ] Membership soft-deleted → 401  
- [ ] User DISABLED → todas sessions inválidas  
- [ ] Company SUSPENDED → sessions da company inválidas  
- [ ] Role alterada → RolesGuard usa role nova  
- [ ] Token access com cid antigo ≠ session → rejeitado ou alinhado à session  
- [ ] Refresh com membership inválida → 401  
- [ ] Refresh reuse → session revoked  
- [ ] Logout-all → N devices 401  
- [ ] 6º login com MAX=5 → oldest revoked  
- [ ] Webhook inalterado  
- [ ] Tenant ALS só com cid validado  

---

## 14. Riscos do próprio hardening

| Risco | Mitigação |
|---|---|
| Latência extra (1–2 queries/request) | `include` único session→user→membership→company; índice M2 |
| Falso 401 por soft-delete extension | Queries explícitas com relações; testes |
| Clientes com muitos devices | MAX sessions documentado; logout-others |
| Race revoke vs request | Fail-closed; session revokedAt checked first |
| Quebra de refresh se membership null após suspend | requiresCompanySelection ou 401 claro |

---

## 15. Decisões pedindo aprovação

| ID | Pergunta | Recomendação |
|---|---|---|
| **AH1** | Revalidar Membership/Company a **cada** access? | **Sim** |
| **AH2** | Claims JWT vs DB: quem vence? | **DB/session** |
| **AH3** | Company SUSPENDED: revoke sessions ou só 403? | **Revoke sessions** |
| **AH4** | Access TTL default 15m ou 5m? | Manter **15m**; permitir config 5m em prod |
| **AH5** | Denylist JWT Redis? | **Não** no 6A |
| **AH6** | Max sessions por user? | **Sim, default 5** |
| **AH7** | Refresh reuse revoga session? | **Sim** |
| **AH8** | Logout-all na 6A.1? | **Sim** |
| **AH9** | Migrations M1–M4 na mesma fase de código? | **6A.1 código sem migration; 6A.2 schema depois** |
| **AH10** | Admin APIs disable/revoke nesta fase? | **Não** — só hooks internos + design |

---

## 16. Relação com roadmap

| Fase | Estado |
|---|---|
| Auth MVP + PR + Hardening P0 | Feitas |
| Architecture audit | Feita — apontou R1/R2 |
| **6A Access Hardening** | **Este design** |
| 6B (provável) | Evolution timeout, Helmet/CORS, Ops reconcile caps |
| 7 | Filas / workers |

---

## 17. Próximo passo

**Aguardar aprovação explícita** deste design (AH1…AH10).  

Somente após aprovação → implementar **6A.1** (código, sem migration) conforme §13.  
**Nenhum código nesta etapa.**

---

*Fim do design Fase 6A — Access Hardening.*
