# Frontend Sprint 3 — Review

**App:** `apps/web`  
**Escopo:** menu administrativo, Team, Users, Settings, Diagnostics, Exports, Setup Wizard, Pipeline, RBAC visual  
**Constraint:** sem alterações em `apps/api` — só endpoints Fase 10 já existentes.

## Entregue

| Área | Rotas | Endpoints |
|------|-------|-----------|
| Menu + RBAC | AppShell | `lib/auth/rbac.ts` |
| Pipeline | `/pipeline` | `GET /api/pipeline` |
| Team | `/team` | `GET/POST/PATCH/DELETE /api/memberships` |
| Users | `/users` | `GET .../sessions`, `POST .../logout-all`, `POST .../revoke-access` |
| Settings | `/settings` | `GET/PATCH /api/settings/company` |
| Exports | `/exports` | `GET /api/exports/{leads,activities,followups}` |
| Diagnostics | `/diagnostics` | `GET /api/ops/diagnostics` |
| Setup | `/setup` | `GET /api/setup/status`, `POST /api/setup/company` + memberships/WhatsApp |

## RBAC visual

| Role | Menu |
|------|------|
| OWNER | Tudo; Settings com slug |
| ADMIN | Tudo; Settings **sem** slug (config crítica) |
| AGENT | Dashboard, Leads, Conversations, FollowUps, WhatsApp, Pipeline, Diagnostics (scope limited) |

## Fluxo sem seed/SQL

1. Login sem memberships → `/setup`  
2. Criar empresa → select-company automático  
3. Convidar equipe (opcional, `delivery: NONE`)  
4. Conectar WhatsApp  
5. Conclusão via `setup/status` → dashboard  

## Fora deste sprint (API existe, UI ainda não)

Lead notes/activities/timeline/assign, AI suggest, ops reconcile/audit completo, follow-up cancel button, dashboard sub-endpoints.
