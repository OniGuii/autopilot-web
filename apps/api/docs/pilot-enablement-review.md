# Fase 10 — Pilot Enablement (Implementation Review)

**Status:** Implemented  
**Branch:** `cursor/pilot-enablement-impl-dd93`  
**Design:** `pilot-enablement-design.md`  
**Decisões aprovadas:** D1–D7  

---

## Decisões aplicadas

| ID | Decisão | Implementação |
|---|---|---|
| D1 | Membership `INVITED`; sem senha temporária; prepare invite futuro | `POST /api/memberships` cria User `PENDING` + `passwordHash=null` (se novo) e Membership `INVITED`; response `invite.delivery=NONE` |
| D2 | Sem disable global de User | `DELETE /memberships/:id` + `POST /users/:id/revoke-access`; logout/sessions **company-scoped** via `logoutCompanyDevices` |
| D3 | Diagnostics por role | OWNER\|ADMIN `scope=full` (openai+workers); AGENT `scope=limited` (postgres/redis/whatsapp) |
| D4 | 1 company por user | `POST /api/setup/company` → `409 SETUP_COMPANY_LIMIT` |
| D5 | Export hard cap 10k | `413` + `code: EXPORT_LIMIT_EXCEEDED`; sem async |
| D6 | `currency` BRL\|USD\|EUR | Coluna + enum `CompanyCurrency` default `BRL` |
| D7 | Implementação completa + e2e + review | Este documento |

**Não alterado:** WhatsApp Engine, AI Engine, Workers, Dashboard, CRM Operations, RLS helpers.

---

## Migrations

| Migration | Conteúdo |
|---|---|
| `20260804200000_pilot_company_settings` | enum `CompanyCurrency`; `companies.locale`, `business_hours`, `logo_url`, `currency`; unique parcial `uq_companies_slug_active` |

Tabelas novas: **nenhuma**.

---

## Endpoints

| Método | Path | Roles |
|---|---|---|
| `GET` | `/api/settings/company` | OWNER\|ADMIN\|AGENT |
| `PATCH` | `/api/settings/company` | OWNER\|ADMIN |
| `GET` | `/api/memberships` | OWNER\|ADMIN\|AGENT |
| `POST` | `/api/memberships` | OWNER\|ADMIN |
| `PATCH` | `/api/memberships/:id` | OWNER\|ADMIN |
| `DELETE` | `/api/memberships/:id` | OWNER\|ADMIN |
| `GET` | `/api/users/:id/sessions` | OWNER\|ADMIN |
| `POST` | `/api/users/:id/logout-all` | OWNER\|ADMIN (company-scoped) |
| `POST` | `/api/users/:id/revoke-access` | OWNER\|ADMIN (membership revoke) |
| `GET` | `/api/ops/diagnostics` | OWNER\|ADMIN\|AGENT (payload por role) |
| `GET` | `/api/setup/status` | autenticado |
| `POST` | `/api/setup/company` | autenticado (max 1) |
| `GET` | `/api/ops/audit` | V2: `entity`, `userId`, `actionPrefix` |
| `GET` | `/api/audit` | alias V2 |
| `GET` | `/api/exports/leads\|activities\|followups` | OWNER\|ADMIN |

---

## Audit actions (novas)

`COMPANY_SETTINGS_UPDATE`, `COMPANY_CREATE`, `USER_CREATE`, `MEMBERSHIP_CREATE`, `MEMBERSHIP_ROLE_CHANGE`, `MEMBERSHIP_REVOKE`, `USER_LOGOUT_ALL_COMPANY`, `EXPORT_LEADS`, `EXPORT_ACTIVITIES`, `EXPORT_FOLLOWUPS`

(+ hook existente `MEMBERSHIP_REVOKED` via `AuthRevocationService`)

---

## Test surface

| Tipo | Arquivos |
|---|---|
| Unit | `companies.service.spec.ts`, `memberships.service.spec.ts`, `setup.service.spec.ts`, `exports.service.spec.ts`, ops controller permissions (+ diagnostics) |
| E2E | `test/pilot-enablement.e2e-spec.ts` — settings, invite INVITED, diagnostics full/limited, audit V2, export CSV, setup limit + first company |

---

## Riscos remanescentes

1. **Invite delivery** ainda `NONE` — sem e-mail/token; User `PENDING` sem password não faz login até fluxo futuro.  
2. **Memberships INVITED** não entram em `select-company` (só ACTIVE) — esperado até accept-invite.  
3. **OpenAI probe** depende de rede/egress; sem key → `skipped` (não falha o status global sozinho).  
4. **Export count** faz `COUNT(*)` antes do fetch — tables grandes podem ser lentas (cap evita payload, não o count).  
5. **Setup max 1 company** bloqueia multi-tenant real no piloto — intencional (D4).  
6. **Último OWNER** protegido em revoke/demote; self-revoke do único OWNER → 403.

---

## Fora / próxima fase

- Frontend  
- E-mail de convite / accept-invite / set-password  
- Fase 11 (aguardar aprovação)  
- Alterações em engines / CRM / RLS / Dashboard  
