# Auditoria de Dívida Técnica — Autopilot Web Monorepo

**Data:** 2026-08-07  
**Branch base auditada:** `main` (HEAD inclui branding #57, pilot-readiness #55, Lead Workspace #54, Product Polish #53)  
**Escopo:** `apps/api` (NestJS) + `apps/web` (Next.js)  
**Método:** inventário de controllers/rotas × `endpoints.ts` × `features/*/api.ts` × `page.tsx` × flags/stubs/mocks/TODOs

---

## Já resolvido (não listar como gap ativo)

| Entrega | Evidência |
|---------|-----------|
| Lead Workspace | PR #54 — notes, activities, timeline, assign/unassign, status history, painéis conversas/FU em `/leads/[id]` |
| Product Polish | PR #53 — copy PT, EmptyState/ErrorPanel, branding, breadcrumbs, confirmações |
| Branding hardening | PR #57 — `BrandMark` com tamanho intrínseco; regressão login fechada |
| Pilot readiness doc | PR #55 — `docs/pilot-readiness-final.md` |
| Setup wizard UI | `/setup` + `GET/POST /api/setup/*` |
| Team / Users / Settings / Exports / Diagnostics | Sprint 3 — telas reais |
| Middleware cookie-gate | Removido — `middleware.ts` é passthrough; auth no client |

---

## Inventários canônicos

### Controllers API (`apps/api/src/**/*controller*.ts`)

| Arquivo | Prefixo | Rotas |
|---------|---------|-------|
| `modules/auth/auth.controller.ts` | `auth` | POST login, select-company, refresh, logout, logout-all; GET me |
| `modules/leads/leads.controller.ts` | `leads` | POST /, GET /, POST bulk-assign, GET :id, GET :id/timeline, PATCH :id, POST :id/assign, POST :id/unassign, DELETE :id |
| `modules/leads/lead-notes.controller.ts` | `leads/:leadId/notes` | POST, GET, GET :id, PATCH :id, DELETE :id |
| `modules/leads/lead-activities.controller.ts` | `leads/:leadId/activities` | POST, GET, GET :id, PATCH :id, POST :id/complete, POST :id/cancel, DELETE :id |
| `modules/conversations/conversations.controller.ts` | `conversations` | POST, GET, GET :id, PATCH :id, POST :id/close, POST :id/messages |
| `modules/follow-up/follow-up.controller.ts` | `follow-ups` | POST, GET, GET :id, PATCH :id, POST approve/reject/reschedule/cancel/execute/retry |
| `modules/ai/ai.controller.ts` | `ai` | POST conversations/:conversationId/suggest |
| `modules/whatsapp/whatsapp.controller.ts` | `whatsapp` | POST connect, GET status, POST disconnect, POST send, POST webhook/:instanceKey |
| `modules/dashboard/dashboard.controller.ts` | `dashboard` | GET /, overview, leads, conversations, followups |
| `modules/pipeline/pipeline.controller.ts` | `pipeline` | GET / |
| `modules/memberships/memberships.controller.ts` | `memberships` | GET, POST, PATCH :id, DELETE :id |
| `modules/users/users.controller.ts` | `users` | GET :id/sessions, POST :id/logout-all, POST :id/revoke-access |
| `modules/companies/company-settings.controller.ts` | `settings/company` | GET, PATCH |
| `modules/companies/companies.controller.ts` | `companies` | **vazio (scaffold)** |
| `modules/setup/setup.controller.ts` | `setup` | GET status, POST company |
| `modules/ops/ops.controller.ts` | `ops` | GET /, metrics, alerts, health, diagnostics, audit, audit/:id, webhooks, webhooks/:id; POST reconcile/messages, reconcile/followups |
| `modules/ops/audit-alias.controller.ts` | `audit` | GET /, GET :id (alias de ops/audit) |
| `modules/exports/exports.controller.ts` | `exports` | GET leads, activities, followups |
| `modules/events/events.controller.ts` | `events` | **vazio (scaffold)** |
| `modules/health/health.controller.ts` | `health` | GET /, live, ready |
| `observability/metrics.controller.ts` | `metrics` | GET / |

### Endpoints registrados em `apps/web/src/lib/api/endpoints.ts`

```
auth: login, selectCompany, refresh, logout, me
dashboard: full
leads: list, create, byId, timeline, assign, unassign, notes, note, activities, activity, activityComplete, activityCancel
conversations: list, create, byId, close, messages
whatsapp: connect, status, disconnect, send
followUps: list, create, byId, approve, reject, reschedule, execute, cancel, retry
pipeline: get
memberships: list, create, byId
users: sessions, logoutAll, revokeAccess
settings: company
setup: status, company
ops: diagnostics
exports: leads, activities, followups
```

**Ausentes do registry (existem na API):** AI suggest, leads soft-delete, bulk-assign, conversation PATCH, follow-up PATCH, activity GET/PATCH, note GET, ops overview/metrics/alerts/health/audit/webhooks/reconcile, audit alias, dashboard sub-rotas, auth logout-all (self), health, metrics, whatsapp webhook.

### Páginas Next.js (`apps/web/src/app/**/page.tsx`)

| Path | Papel |
|------|-------|
| `src/app/page.tsx` | redirect → `/login` |
| `(public)/login/page.tsx` | Login |
| `(public)/logout/page.tsx` | Logout |
| `(auth)/select-company/page.tsx` | Seleção de empresa |
| `(app)/dashboard/page.tsx` | Painel (GET `/api/dashboard`) |
| `(app)/leads/page.tsx` | Lista leads |
| `(app)/leads/[leadId]/page.tsx` | Lead Workspace |
| `(app)/conversations/page.tsx` | Inbox + criar por UUID |
| `(app)/conversations/[conversationId]/page.tsx` | Thread + send + FU manual |
| `(app)/follow-ups/page.tsx` | Lista FU |
| `(app)/follow-ups/[followUpId]/page.tsx` | Detalhe FU (sem cancel) |
| `(app)/whatsapp/page.tsx` | Conexão WhatsApp |
| `(app)/pipeline/page.tsx` | Funil KPI (não Kanban) |
| `(app)/team/page.tsx` | Memberships |
| `(app)/users/page.tsx` | Sessões / revoke |
| `(app)/settings/page.tsx` | Company settings |
| `(app)/exports/page.tsx` | CSV exports |
| `(app)/diagnostics/page.tsx` | Ops diagnostics only |
| `(app)/setup/page.tsx` | Wizard onboarding |

**Nav** (`app-shell.tsx`): todas as páginas app estão no menu (filtradas por RBAC). Detalhes (`/leads/:id`, `/conversations/:id`, `/follow-ups/:id`) não são itens de nav — ok.

---

## 1. API endpoints sem UI

Severidade: **P0** = bloqueia fluxo produto; **P1** = gap operacional claro; **P2** = nice-to-have / já coberto por outro endpoint.

| Severidade | Endpoint API | Evidência de ausência no web |
|------------|--------------|------------------------------|
| **P0** | `POST /api/ai/conversations/:id/suggest` | Sem entrada em `endpoints.ts`; sem `features/ai`; conversa só cria FU manual (`conversations/[conversationId]/page.tsx`) |
| **P1** | `DELETE /api/leads/:id` (soft delete) | Sem client em `features/leads/api.ts`; Lead Workspace não tem ação excluir |
| **P1** | `POST /api/leads/bulk-assign` | Zero matches em `apps/web`; sem seleção múltipla na lista |
| **P1** | `POST /api/follow-ups/:id/cancel` | Client existe (`cancelFollowUp` em `features/follow-ups/api.ts`) mas **não é importado** na página de detalhe |
| **P1** | `GET /api/ops/audit`, `GET /api/ops/audit/:id`, alias `GET /api/audit*` | Só `ops.diagnostics` no registry; `/diagnostics` não lista audit |
| **P1** | `GET /api/ops/webhooks`, `GET /api/ops/webhooks/:id` | Idem |
| **P1** | `POST /api/ops/reconcile/messages`, `POST /api/ops/reconcile/followups` | Idem — só Swagger/API |
| **P2** | `GET /api/ops`, `metrics`, `alerts`, `health` | Parcialmente refletidos em diagnostics; sem telas dedicadas |
| **P2** | `GET /api/dashboard/overview\|leads\|conversations\|followups` | UI usa só `GET /api/dashboard` (full) — ok funcionalmente |
| **P2** | `PATCH /api/conversations/:id` | Sem wrapper; UI só `close` |
| **P2** | `PATCH /api/follow-ups/:id` | Sem wrapper; ações usam approve/reject/reschedule/… |
| **P2** | `GET/PATCH .../activities/:id` | UI: list/create/complete/cancel; sem edit/get-by-id |
| **P2** | `DELETE .../activities/:id` | `deleteLeadActivity` no client **sem uso** no painel |
| **P2** | `GET/PATCH .../notes/:id` | UI: list/create/delete; `updateLeadNote` **sem uso** |
| **P2** | `POST /api/auth/logout-all` (self) | UI tem `users/:id/logout-all` (admin); não o self-service |
| **P2** | Controllers vazios `companies`, `events` | Scaffold — sem rotas |
| Infra | `GET /health*`, `GET /metrics`, `POST /whatsapp/webhook/:key` | Intencional (ops/infra; webhook externo) |

---

## 2. UI sem endpoint real / wiring frágil

| Severidade | Tela / trecho | Problema | Evidência |
|------------|---------------|----------|-----------|
| **P1** | `/conversations` — “Nova conversa” | Pede UUID cru do lead; UX frágil (não é mock, mas wiring fraco) | `conversations/page.tsx` Input “Identificador do lead”; Lead Workspace copia UUID para clipboard |
| **P1** | Fluxo IA na conversa | Follow-up manual com `suggestedBody` **não** chama AI | `createFollowUp` em vez de `POST /ai/.../suggest` |
| **P2** | `/pipeline` | KPI cards — não board; OK se expectativa for funil, gap se pitch for Kanban | `pipeline/page.tsx` — `leadsByStage` bars |
| **P2** | Convite Team/Setup | API marca `invite.delivery: 'NONE'` — UI convida, ativação offline | `memberships.service.ts` |
| — | Páginas app | **Sem MSW / mock data / demo hardcoded** no frontend de produto | Grep `msw|mockData|fixture` = vazio em `apps/web/src` |

Não há páginas que chamem APIs inexistentes. O padrão dominante é **API à frente da UI**.

---

## 3. Features parcialmente implementadas

| Feature | API | Client web | UI | Gap |
|---------|-----|------------|----|-----|
| AI Suggest | ✓ | ✗ | ✗ | Fluxo IA bloqueado no produto (**P0** se IA for vendida) |
| Soft delete lead | ✓ | ✗ | ✗ | Limpeza de base (**P1**) |
| Bulk-assign | ✓ | ✗ | ✗ | Distribuição carteira (**P1**) |
| Cancel follow-up | ✓ | ✓ (`cancelFollowUp`) | ✗ botão | Higiene funil sugestões (**P1**) |
| Lead notes edit | ✓ PATCH | ✓ `updateLeadNote` | ✗ | Só create/delete (**P2**) |
| Activity soft-delete / edit | ✓ | delete wrapper unused; no PATCH | create/complete/cancel only | (**P2**) |
| Conversation assign/status patch | ✓ PATCH | ✗ | só close | (**P2**) |
| Pipeline Kanban | GET agregados | ✓ | KPI only | Não drag-and-drop (**P2**/produto) |
| Criar conversa | ✓ | ✓ | UUID paste | Falta picker (**P1** UX) |
| Ops Audit/Reconcile/Webhooks | ✓ | ✗ | só diagnostics | Suporte L2 (**P1** escala) |
| Membership invite e-mail | partial (`delivery: NONE`) | create ok | convida | Ativação offline (**P1** piloto pago) |
| Lead Workspace | ✓ | ✓ | ✓ | Resolvido — assign/unassign/notes/activities/timeline |

---

## 4. Feature flags / env que deveriam virar defaults (ou decisão explícita)

Fonte: `apps/api/.env.example`, `configuration.ts`, `env.validation.ts`.

| Flag | Default atual | Nota |
|------|---------------|------|
| `ASYNC_INBOUND_ENABLED` | `false` | Webhook sync; para prod com volume → considerar `true` |
| `ASYNC_FOLLOWUP_ENABLED` | `false` | Execute só manual; scheduler off |
| `ASYNC_RECONCILE_ENABLED` | `false` | Reconcile só via POST ops |
| `ASYNC_AI_ENABLED` | `false` | Suggest sync; ok até UI existir |
| `ASYNC_OUTBOUND_ENABLED` | `false` | Send WhatsApp sync |
| `ASYNC_WORKERS_IN_API` | `true` | Já default embutido — ok piloto single-process |
| `OTEL_ENABLED` | `false` | Observabilidade externa off |
| `METRICS_ENABLED` | `true` | Já default on |
| `SWAGGER_ENABLED` | on em dev; off em prod salvo explícito | OK |
| `EVOLUTION_CB_ENABLED` | `true` | OK |
| `OPENAI_API_KEY` vazio | Suggest → 503 (exceto stub `NODE_ENV=test`) | Precisa key no piloto se IA ligada |
| `EVOLUTION_API_URL` vazio | Stub só em development/test; **proibido em production** | OK política P0 |
| `ALLOW_PROD_SEED` | não no example; seed recusa prod | Manter off |
| Web | Sem `FEATURE_*` | Só `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_APP_URL` |

**Recomendação de defaults para piloto assistido com canal real:** manter async workers off até estabilizar Evolution; ligar `ASYNC_INBOUND`/`OUTBOUND`/`FOLLOWUP` quando filas forem validadas. Não há flag de feature frontend a “promover”.

---

## 5. Stubs ainda existentes

| Stub | Onde | Política |
|------|------|----------|
| Evolution fake QR/send | `apps/api/src/modules/whatsapp/evolution.client.ts` | Stub se URL vazia; `assertStubAllowed()` só development/test; prod lança |
| OpenAI stub | `apps/api/src/modules/ai/openai.client.ts` | Só `NODE_ENV=test` sem key; fora → 503 |
| Controllers scaffold | `companies.controller.ts`, `events.controller.ts` + `events.service.ts` | Vazios — dívida de limpeza ou implementação futura |
| Diagnostics `openai: skipped` | `ops.service.ts` quando key ausente | Intencional |
| Jest doubles | `*.spec.ts`, e2e helpers | Só testes — **não** em paths de prod |

---

## 6. Mocks ainda existentes

| Tipo | Resultado |
|------|-----------|
| MSW no web | **Ausente** |
| Mock data em pages | **Ausente** |
| Demo hardcoded em UI | **Ausente** (labels/constants OK) |
| Jest mocks | Apenas specs API — esperado |
| Docs desatualizados como “mock de produto” | `docs/frontend-architecture.md` descreve AI/BulkActionBar/Kanban paths que **não existem** — dívida documental (**P2**) |

---

## 7. TODOs / FIXMEs / HACKs / XXX

Grep em `apps/` e `docs/` (código + markdown):

- **Nenhum** `TODO` / `FIXME` / `HACK` / `XXX` em comentários de código.
- Apenas `eslint-disable-next-line` pontuais (img QR WhatsApp/settings, console em seed/perf).

Dívida está **implícita** (scaffolds, clients mortos, docs arquiteturais), não marcada com TODO.

---

## 8. Rotas não usadas / mortas

### Next.js
| Item | Estado |
|------|--------|
| Middleware matcher | Lista rotas mas handler é `NextResponse.next()` — matcher **morto funcionalmente** (`middleware.ts`) |
| Páginas fora do nav | Só detalhes dinâmicos — ok |
| Rewrite `/backend/*` | Ativo — proxy BFF leve (`next.config.ts`) |

### API nunca chamada pelo web
Ver seção 1 (AI, bulk-assign, soft-delete, ops avançado, dashboard subs, PATCH conversation/FU, auth logout-all self, health/metrics).

### Client wrappers mortos / semi-mortos
| Função | Arquivo | Uso UI |
|--------|---------|--------|
| `cancelFollowUp` | `features/follow-ups/api.ts` | Nenhum |
| `updateLeadNote` | `features/leads/notes-api.ts` | Nenhum |
| `deleteLeadActivity` | `features/leads/activities-api.ts` | Nenhum |

---

## 9. Componentes / padrões duplicados

| Padrão | Ocorrências | Nota |
|--------|-------------|------|
| Status badges tipados | `LeadStatusBadge`, `FollowUpStatusBadge`, `WhatsAppStatusBadge` | OK por domínio; conversas usam `Badge` genérico + `CONVERSATION_STATUS_LABEL` |
| `MEMBERSHIP_STATUS_LABEL` | Duplicado em `team/page.tsx` e `users/page.tsx` | Extrair para `lib/nav` ou constants |
| Team vs Users | Duas páginas admin sobrepostas (memberships vs sessions) | Unificar ou deixar claro na nav (“Equipe” vs “Sessões”) |
| PageHeader | Usado consistentemente | Pouca ad-hoc header debt |
| EmptyState / ErrorPanel / LoadingBlock | Consistentes pós-Polish | OK |
| Query keys WhatsApp | `["whatsapp","status"]` vs `["whatsapp-status"]` no setup | Inconsistência — cache não compartilhado |
| Query keys memberships | `["memberships"]`, `["memberships", statusFilter]`, `["memberships","users-admin"]`, `["memberships","assign-picker"]` | Funciona; consolidar factory ajudaria |
| API wrappers | `features/*/api.ts` + `endpoints.ts` | Padrão bom; AI e ops avançado faltando no registry |
| Docs architecture vs código | Paths AI antigos (`/api/ai/leads/...`) | Doc legado |

---

## 10. Oportunidades de simplificação

1. **Unificar Team + Users** (ou renomear Users → “Sessões e acesso”) — mesma fonte `listMemberships`.
2. **Registrar AI + soft-delete + bulk-assign em `endpoints.ts`** mesmo antes da UI — evita drift.
3. **Botão Cancel no detalhe FU** — 1 mutation; client já existe (**quick win P1**).
4. **Picker de lead** na criação de conversa — reutilizar `listLeads` search.
5. **Consolidar query keys** (`queryKeys.ts`) — especialmente WhatsApp/setup.
6. **Remover ou implementar** scaffolds `companies`/`events` controllers.
7. **Arquivar/atualizar** `docs/frontend-architecture.md` (paths AI/BulkAction inventados).
8. **Middleware:** remover matcher morto ou restaurar gate cookie consciente.
9. **Tokens `localStorage` + rewrite `/backend`:** aceitável piloto; SaaS precisa BFF HttpOnly.
10. **Dashboard sub-rotas:** se ninguém consumir fora do full, documentar como internos ou deprecar public surface.

---

## Mapa rápido: endpoints.ts × uso UI

| Endpoint registry | Usado na UI? |
|-------------------|--------------|
| auth.* | Sim (login/select/me/logout/refresh) |
| dashboard.full | Sim |
| leads list/create/byId/timeline/assign/unassign | Sim |
| leads notes/activities (+ complete/cancel) | Sim (Workspace) |
| leads note PATCH / activity DELETE | Client parcial, UI incompleta |
| conversations * | Sim (sem PATCH) |
| whatsapp * | Sim (webhook N/A) |
| followUps * exceto cancel na UI | approve/reject/reschedule/execute/retry sim; **cancel não** |
| pipeline.get | Sim |
| memberships * | Sim (Team/Setup) |
| users sessions/logoutAll/revoke | Sim (Users) |
| settings/setup/exports/ops.diagnostics | Sim |

---

## Priorização sugerida (dívida acionável)

| Prioridade | Item | Esforço relativo |
|------------|------|------------------|
| P0 | AI suggest na conversa (+ endpoints.ts + loading/erro) | Médio — API pronta |
| P1 | Botão cancel follow-up | Baixo |
| P1 | Picker lead → criar conversa | Baixo/médio |
| P1 | Soft delete lead UI | Baixo |
| P1 | Bulk-assign UI | Médio |
| P1 | Ops audit/reconcile superfície mínima | Médio |
| P2 | Editar nota / activity PATCH | Baixo |
| P2 | Unificar Team/Users + query keys | Baixo |
| P2 | Limpar scaffolds + atualizar architecture.md | Baixo |
| P2 | Pipeline Kanban | Alto — só se produto exigir |

---

## Referências cruzadas

- `docs/pilot-readiness-final.md` — fluxos OWNER/ADMIN/AGENT e blockers piloto  
- `docs/lead-workspace-review.md` — o que o Workspace cobriu / não cobriu  
- `docs/ui-showcase.md` — gaps UX conhecidos (cancel FU, Kanban, AI)  
- `docs/frontend-architecture.md` — **desatualizado** vs API real de AI
