# Dívida Técnica Final — Autopilot

**Tipo:** auditoria (somente documentação — sem implementação)  
**Data:** 2026-08-07  
**Base:** `main` pós Sprint 1–3, Product Polish, Lead Workspace, Pilot Readiness, fix login + branding hardening (PRs #53–#57)  
**Escopo:** `apps/api` (NestJS) + `apps/web` (Next.js)

---

## Veredito

A dívida dominante é **API à frente da UI**: a maioria dos gaps são endpoints prontos sem superfície web (IA, bulk-assign, soft delete, ops avançado, cancel FU). Não há mocks de produto no frontend. Não há `TODO`/`FIXME` marcados no código — a dívida é estrutural e documental.

| Severidade | Significado neste doc |
|------------|------------------------|
| **P0** | Bloqueia fluxo de produto se a capacidade for vendida/esperada |
| **P1** | Gap operacional claro no piloto |
| **P2** | Limpeza, DX ou nice-to-have |

---

## Já resolvido (não é dívida ativa)

| Entrega | Evidência |
|---------|-----------|
| Lead Workspace | Notes, activities, timeline, assign, histórico, painéis |
| Product Polish | Copy PT, empty/error/loading, branding, breadcrumbs |
| Branding hardening | BrandMark com tamanho intrínseco + caps CSS |
| Setup / Team / Users / Settings / Exports / Diagnostics | Sprint 3 |
| Auth middleware race | Passthrough; gate no client |

---

## 1. Endpoints sem tela

| Sev | Endpoint | Nota |
|-----|----------|------|
| **P0** | `POST /api/ai/conversations/:id/suggest` | Fora de `endpoints.ts`; sem `features/ai`; conversa só cria FU manual |
| **P1** | `DELETE /api/leads/:id` | Soft delete — sem client/UI |
| **P1** | `POST /api/leads/bulk-assign` | Sem seleção múltipla na lista |
| **P1** | `POST /api/follow-ups/:id/cancel` | Client `cancelFollowUp` existe; **sem botão** no detalhe |
| **P1** | `GET /api/ops/audit`, `GET /api/ops/audit/:id`, alias `/api/audit*` | Só diagnostics na UI |
| **P1** | `GET /api/ops/webhooks`, `GET /api/ops/webhooks/:id` | API-only |
| **P1** | `POST /api/ops/reconcile/messages`, `.../followups` | API-only |
| **P2** | `GET /api/ops`, `metrics`, `alerts`, `health` | Parcial via diagnostics |
| **P2** | `GET /api/dashboard/{overview,leads,conversations,followups}` | UI usa só `GET /api/dashboard` full |
| **P2** | `PATCH /api/conversations/:id` | UI só `close` |
| **P2** | `PATCH /api/follow-ups/:id` | Ações via approve/reject/reschedule/… |
| **P2** | `GET/PATCH .../notes/:id`, `GET/PATCH .../activities/:id` | UI parcial (ver §3) |
| **P2** | `DELETE .../activities/:id` | Wrapper `deleteLeadActivity` sem uso |
| **P2** | `POST /api/auth/logout-all` (self) | UI só logout-all admin em `/users` |
| Infra | `/health*`, `/metrics`, `POST /whatsapp/webhook/:key` | Intencional (ops/S2S) |
| Scaffold | Controllers `companies`, `events` | Vazios — sem rotas |

### Ausentes do registry `endpoints.ts` (existem na API)

AI suggest · soft-delete · bulk-assign · conversation PATCH · follow-up PATCH · note/activity GET·PATCH · ops audit/webhooks/reconcile/alerts · dashboard sub-rotas · auth logout-all self · health/metrics · webhook WhatsApp.

---

## 2. Telas sem endpoint (ou wiring frágil)

Não há páginas que chamem APIs **inexistentes**. Gaps são de UX / expectativa:

| Sev | Tela | Problema |
|-----|------|----------|
| **P1** | `/conversations` — nova conversa | Pede UUID cru do lead (não é mock; wiring frágil) |
| **P1** | `/conversations/[id]` — “sugestão” | Texto manual → `createFollowUp`; **não** chama AI |
| **P2** | `/pipeline` | Funil KPI, não Kanban — gap só se o pitch for board |
| **P2** | `/team`, `/setup` — convite | UI convida; API `invite.delivery: NONE` (ativação offline) |

Todas as rotas app estão no menu (RBAC). Detalhes dinâmicos (`/leads/:id`, etc.) corretamente fora do nav.

---

## 3. Funcionalidades parcialmente implementadas

| Feature | API | Client | UI | Gap |
|---------|:---:|:------:|:--:|-----|
| AI Suggest | ✓ | ✗ | ✗ | **P0** se IA for vendida |
| Soft delete lead | ✓ | ✗ | ✗ | **P1** |
| Bulk-assign | ✓ | ✗ | ✗ | **P1** |
| Cancel follow-up | ✓ | ✓ | ✗ botão | **P1** quick win |
| Editar nota | ✓ | ✓ `updateLeadNote` | ✗ | **P2** |
| Delete/edit activity | ✓ | delete unused | complete/cancel only | **P2** |
| Criar conversa | ✓ | ✓ | UUID paste | **P1** picker |
| Pipeline Kanban | agregados | ✓ | KPI only | **P2**/produto |
| Ops audit/reconcile | ✓ | ✗ | só diagnostics | **P1** escala |
| Convite e-mail | partial | ✓ | convida | **P1** piloto pago |
| Lead Workspace | ✓ | ✓ | ✓ | Resolvido |

---

## 4. Flags que deveriam virar padrão (ou decisão explícita)

Fonte: `apps/api/src/config/configuration.ts`, `env.validation.ts`.

| Flag | Default | Recomendação |
|------|---------|--------------|
| `ASYNC_INBOUND_ENABLED` | `false` | Manter off até Evolution estável; ligar em piloto com volume |
| `ASYNC_OUTBOUND_ENABLED` | `false` | Idem |
| `ASYNC_FOLLOWUP_ENABLED` | `false` | Ligar quando scheduler for validado |
| `ASYNC_RECONCILE_ENABLED` | `false` | Ligar com ops L2 / filas estáveis |
| `ASYNC_AI_ENABLED` | `false` | Manter até existir UI de suggest; sync basta no início |
| `ASYNC_WORKERS_IN_API` | `true` | OK para piloto single-process; separar workers em escala |
| `OTEL_ENABLED` | `false` | Ligar em staging/prod com collector |
| `METRICS_ENABLED` | `true` | Já adequado |
| `SWAGGER_ENABLED` | off em prod | Manter |
| `EVOLUTION_CB_ENABLED` | `true` | Manter |
| Stub Evolution (URL vazia) | só dev/test | **Nunca** default em prod (já bloqueado) |
| Web `FEATURE_*` | inexistente | Sem flags frontend a promover |

**Não “virar true” às cegas:** async deve virar padrão só após smoke com Redis/Evolution reais.

---

## 5. Stubs ainda existentes

| Stub | Onde | Política |
|------|------|----------|
| Evolution fake QR/send | `whatsapp/evolution.client.ts` | Permitido só development/test; prod falha |
| OpenAI stub | `ai/openai.client.ts` | Só `NODE_ENV=test` sem key |
| Controllers vazios | `companies.controller.ts`, `events.controller.ts` (+ service) | Scaffold morto |
| Diagnostics `openai: skipped` | `ops.service.ts` | Intencional sem key |
| Jest doubles | `*.spec.ts` / e2e | Só testes — OK |

---

## 6. Mocks ainda existentes

| Tipo | Estado |
|------|--------|
| MSW / mock service worker | **Ausente** |
| Mock data em pages de produto | **Ausente** |
| Demo hardcoded em UI | **Ausente** |
| Jest mocks | Specs API — esperado |
| Doc como “mock de arquitetura” | `docs/frontend-architecture.md` descreve AI/`BulkActionBar`/paths que **não existem** (**P2** documental) |

---

## 7. TODOs / FIXMEs

Grep em `apps/web/src` e `apps/api/src` (código):

- **Zero** `TODO` / `FIXME` / `HACK` / `XXX` em comentários.
- Apenas `eslint-disable-next-line` pontuais (`img` QR/settings).

Dívida **não está marcada** no código — vive em scaffolds, clients mortos e docs.

---

## 8. Rotas não utilizadas

### Next.js
| Item | Estado |
|------|--------|
| `middleware.ts` matcher | Lista rotas, mas handler é passthrough — matcher **morto funcionalmente** |
| Páginas órfãs | Nenhuma app page fora do produto |
| Rewrite `/backend/*` | Ativo (proxy) |

### Client wrappers sem UI
| Função | Arquivo |
|--------|---------|
| `cancelFollowUp` | `features/follow-ups/api.ts` |
| `updateLeadNote` | `features/leads/notes-api.ts` |
| `deleteLeadActivity` | `features/leads/activities-api.ts` |

### API nunca chamada pelo web
Ver §1 (AI, bulk-assign, soft-delete, ops avançado, dashboard subs, PATCHs, logout-all self, health/metrics).

---

## 9. Componentes duplicados / inconsistências

| Padrão | Onde | Ação sugerida |
|--------|------|---------------|
| `MEMBERSHIP_STATUS_LABEL` | Duplicado em `team/page.tsx` e `users/page.tsx` | Extrair constants |
| Team vs Users | Duas telas admin sobre a mesma fonte | Unificar ou renomear Users → “Sessões” |
| Conversation status | Badge genérico vs badges tipados de Lead/FU/WA | Opcional: `ConversationStatusBadge` |
| Query key WhatsApp | `["whatsapp","status"]` vs `["whatsapp-status"]` (setup) | Unificar — cache não compartilha |
| Query keys memberships | Várias chaves ad hoc | Factory `queryKeys.ts` |
| Doc architecture | Paths AI/Bulk inventados | Atualizar ou arquivar |

`PageHeader` / `EmptyState` / `ErrorPanel` / `LoadingBlock` estão consistentes (pós-Polish).

---

## 10. Oportunidades de simplificação

1. **Cancel FU na UI** — client pronto; 1 botão (**P1**, esforço baixo).  
2. **Picker de lead** ao criar conversa — reusar `listLeads`.  
3. **Registrar AI / soft-delete / bulk-assign em `endpoints.ts`** antes da UI — evita drift.  
4. **Unificar Team + Users** (abas Membros | Sessões).  
5. **`queryKeys.ts`** — especialmente WhatsApp/setup.  
6. **Remover ou implementar** scaffolds `companies` / `events`.  
7. **Atualizar** `docs/frontend-architecture.md` (ou marcar deprecated).  
8. **Middleware:** remover matcher morto ou restaurar gate cookie consciente.  
9. **Dashboard sub-rotas:** documentar como internos ou deprecar se ninguém consumir.  
10. **Sessão:** `localStorage` ok piloto; SaaS → BFF HttpOnly (não simplifica agora, mas evita dívida de segurança).

---

## Inventários de referência

### Controllers API
`auth`, `leads`, `lead-notes`, `lead-activities`, `conversations`, `follow-up`, `ai`, `whatsapp`, `dashboard`, `pipeline`, `memberships`, `users`, `company-settings`, `companies` *(vazio)*, `setup`, `ops`, `audit-alias`, `exports`, `events` *(vazio)*, `health`, `metrics`.

### Páginas web
`/login`, `/logout`, `/select-company`, `/dashboard`, `/leads`, `/leads/[id]`, `/conversations`, `/conversations/[id]`, `/follow-ups`, `/follow-ups/[id]`, `/whatsapp`, `/pipeline`, `/team`, `/users`, `/settings`, `/exports`, `/diagnostics`, `/setup`.

### Registry `endpoints.ts` (usado)
auth · dashboard.full · leads (+ workspace) · conversations · whatsapp · followUps · pipeline · memberships · users · settings · setup · ops.diagnostics · exports.

---

## Priorização acionável

| Prioridade | Item | Esforço |
|------------|------|---------|
| P0 | AI suggest na conversa | Médio (API pronta) |
| P1 | Botão cancel follow-up | Baixo |
| P1 | Picker de lead | Baixo/médio |
| P1 | Soft delete + bulk-assign UI | Baixo / médio |
| P1 | Ops audit/reconcile mínimo | Médio |
| P2 | Editar nota; limpar scaffolds; unificar Team/Users; query keys; architecture.md | Baixo |
| P2 | Pipeline Kanban | Alto — só se produto exigir |

---

## Referências

- `docs/pilot-readiness-final.md` — prontidão por fluxo  
- `docs/lead-workspace-review.md` — o que o Workspace cobriu  
- `docs/login-regression-audit.md` / `docs/branding-hardening-review.md` — regressões visuais fechadas  
- `docs/frontend-architecture.md` — **desatualizado** vs código atual  
- `docs/ui-showcase.md` — gaps UX históricos (parcialmente superados pelo Polish/Workspace)
