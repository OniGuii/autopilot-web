# Auditoria do Estado do Projeto — Autopilot Web

**Tipo:** Relatório executivo (somente leitura — sem implementação)  
**Data:** 2026-08-04  
**Repositório:** `autopilot-web`  
**Escopo:** estado atual do monorepo e da API; gaps para piloto com clientes reais  
**Modo produto atual:** API-only; frontend não existe; manutenção de piloto documentada em fases 10 / 10.5

---

## Sumário executivo

O repositório é um **monorepo preparado** que hoje contém **apenas uma aplicação executável**: `apps/api` (NestJS). Não há frontend web, mobile, painel admin UI nem landing page. O “produto” utilizável localmente é a **API REST + Swagger + workers opcionais**, com Postgres e Redis.

Para um piloto com clientes finais, o maior gap é **ausência total de UI** (e de self-serve onboarding completo: não há registro público de usuário; convites ficam `INVITED` sem e-mail/senha). A API de domínio (auth, leads, WhatsApp, AI, CRM ops, exports, setup) está avançada.

---

## 1. Estrutura do monorepo

```text
autopilot-web/
├── README.md                 # visão do monorepo
├── .gitignore
├── .github/workflows/
│   └── api-ci.yml            # CI da API (lint · test · e2e · build)
└── apps/
    └── api/                  # ÚNICA app presente
        ├── src/              # NestJS
        ├── prisma/           # schema, migrations, seeds
        ├── test/             # e2e
        ├── docs/             # designs, reviews, runbooks
        ├── scripts/          # db-start/stop, perf-baseline
        ├── docker-compose.yml
        ├── Dockerfile
        ├── package.json      # @autopilot/api (pacote npm independente)
        ├── Architecture.md
        ├── Roadmap.md
        └── README.md
```

| Aspecto | Estado |
|---|---|
| Workspace npm/pnpm/turbo/nx | **Não** — sem `package.json` raiz de workspace; só `apps/api/package.json` |
| `packages/` compartilhados | **Não existe** |
| Apps planejadas | README raiz menciona `apps/web` (Next.js) como **ainda não criado** |
| CI | Um workflow: API CI |

---

## 2. Quais aplicações existem

| Path | Tipo | Status |
|---|---|---|
| `apps/api` | Backend NestJS 11 + Prisma + BullMQ | **Existe e é o foco do repo** |
| `apps/web` | Frontend Next.js (planejado) | **Não existe** |
| App mobile | — | **Não existe** |
| Landing / marketing site | — | **Não existe** |
| Admin panel (UI) | — | **Não existe** (há APIs Ops/Audit) |

---

## 3. Quais aplicações são executáveis

| Entrypoint | Comando | Função |
|---|---|---|
| API HTTP | `npm run start:dev` / `start:prod` | `src/main.ts` — Nest API porta **3001** |
| Worker async | `npm run start:worker` / `start:worker:dev` | `src/worker.main.ts` — processa filas Bull |
| Workers in-API | default `ASYNC_WORKERS_IN_API=true` | Workers embutidos no processo da API |
| Docker stack | `docker compose up -d` | `api` + `postgres` + `redis` |
| Seeds | `npm run seed:{local,demo,test,pilot}` | Popula dados (non-prod) |
| Perf baseline | `npm run perf:baseline` | Script de medição local |

**Única app de produto executável hoje:** a API (e seu worker).

---

## 4. Existe frontend web?

**Não.**

- Zero arquivos `.tsx` / `.jsx` / `.vue` / `.svelte` / HTML de app
- README raiz: `# apps/web  # Frontend Next.js — ainda não criado`
- Consumo atual da API: Swagger UI, curl/Postman, testes e2e

---

## 5. Existe frontend mobile?

**Não.** Nenhum projeto React Native, Flutter, Expo, Capacitor ou similar.

---

## 6. Existe painel administrativo?

**API de operações sim; UI de painel não.**

Superfície admin/ops via REST (JWT + roles):

| Área | Paths (prefixo `/api`) |
|---|---|
| Ops | `/ops`, `/ops/metrics`, `/ops/alerts`, `/ops/health`, `/ops/diagnostics` |
| Audit | `/ops/audit`, `/audit` (alias) |
| Webhooks monitor | `/ops/webhooks` |
| Reconcile | `/ops/reconcile/messages`, `/ops/reconcile/followups` |
| Memberships / users | `/memberships`, `/users/:id/*` |
| Settings | `/settings/company` |
| Exports | `/exports/*` |

Isso é **admin-as-API**, não um painel administrativo web.

Scaffolds vazios (sem rotas de negócio): `CompaniesController`, `EventsController` (e historicamente users era scaffold — hoje tem rotas de sessão/revoke).

---

## 7. Existe landing page?

**Não.** Sem site de marketing, páginas estáticas de produto ou app Next/Remix para aquisição.

---

## 8. Lista completa dos módulos do backend

Local: `apps/api/src/modules/` (+ `core`, `config`, `prisma`, `shared`, `observability`).

| Módulo | Função | Rotas de negócio? |
|---|---|---|
| `auth` | Login, select-company, refresh, logout, me, revogação | Sim |
| `companies` | Settings company (GET/PATCH); controller `/companies` scaffold | Parcial |
| `users` | Sessions, logout-all company-scoped, revoke-access | Sim |
| `memberships` | List/invite/role/revoke | Sim |
| `setup` | Wizard status + create first company | Sim |
| `leads` | CRUD leads, assign/unassign/bulk, timeline | Sim |
| `leads` (notes) | CRUD notes | Sim |
| `leads` (activities) | CRUD + complete/cancel | Sim |
| `conversations` | Conversations + messages | Sim |
| `whatsapp` | Connect/status/disconnect/send + webhook Evolution | Sim |
| `ai` | Suggest reply por conversation | Sim |
| `follow-up` | CRUD + approve/reject/reschedule/cancel/execute/retry | Sim |
| `dashboard` | KPIs overview/leads/conversations/followups | Sim |
| `pipeline` | KPIs operacionais de funil | Sim |
| `exports` | CSV leads/activities/followups | Sim |
| `ops` | Metrics, alerts, health, diagnostics, audit, webhooks, reconcile | Sim |
| `audit` | Service de escrita + listagem (alias controller em ops) | Sim (via ops) |
| `async` | Filas BullMQ, producers, processors, DLQ | Interno |
| `health` | `/health`, `/live`, `/ready` | Sim (público) |
| `events` | Scaffold | Não |
| Observability | Metrics Prometheus `/metrics`, OTEL opcional | Sim |

**Enums/domínio principais (Prisma):** Company, User, Membership, Session, Lead (+ notes/activities/transitions), Conversation, Message, FollowUp, WhatsAppInstance, WebhookEvent, AuditLog, Event.

---

## 9. Variáveis obrigatórias do `.env`

Validação: `src/config/env.validation.ts` (Joi).

### Obrigatórias de verdade (boot falha sem elas)

| Variável | Notas |
|---|---|
| `DATABASE_URL` | **Required** sempre |
| `JWT_ACCESS_SECRET` | **Required** se `NODE_ENV ≠ test`; mín. 32 chars; proíbe default inseguro |

### Fortemente necessárias para uso real (defaults existem, mas… )

| Variável | Default / comportamento |
|---|---|
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` — **ready** e filas dependem de Redis |
| `PORT` | `3001` |
| `API_PREFIX` | `api` |
| `NODE_ENV` | `development` |

### Opcionais mas críticas no piloto real

| Variável | Sem valor |
|---|---|
| `OPENAI_API_KEY` | Suggest → **503** (exceto stub em `NODE_ENV=test`) |
| `EVOLUTION_API_URL` (+ key) | Modo **stub** (só development/test); prod precisa Evolution real |
| `API_PUBLIC_URL` | Webhook URL Evolution; default implícito local |
| `SWAGGER_*` | Em prod com Swagger on, user/password obrigatórios |

Demais flags (`ASYNC_*`, timeouts Evolution, OTEL, throttle, etc.) têm defaults seguros (muitos workers **off** por default: inbound/AI/outbound/followup/reconcile sync ou manual).

**Não existem** variáveis SMTP, S3/Storage, OAuth social no schema de env.

---

## 10. Dependências externas necessárias

| Dependência | Necessária? | Estado no projeto |
|---|---|---|
| **PostgreSQL** | **Sim (obrigatória)** | Docker `postgres:16`; Prisma + RLS |
| **Redis** | **Sim (operacional)** | Docker `redis:7`; BullMQ + cache auth + ready |
| **OpenAI** | Para AI suggest em non-test | Opcional no boot; sem key = 503 no suggest |
| **Evolution API** | Para WhatsApp real | Opcional no boot; stub local; prod precisa URL/key |
| **SMTP** | **Não implementado** | Sem env, sem módulo de e-mail; invites `delivery=NONE` |
| **Storage (S3/etc.)** | **Não implementado** | `logoUrl` é string URL; sem upload |

---

## 11. Comandos para subir tudo localmente

```bash
# Clone e API
cd apps/api
cp .env.example .env
# Editar: JWT_ACCESS_SECRET (>=32), DATABASE_URL, Redis

npm install

# Infra
npm run db:start
# = docker compose up -d postgres redis  (ou fallback nativo)

# Schema
npx prisma generate
npm run db:migrate

# Dados (escolher um)
npm run seed:local    # dev
# npm run seed:pilot  # Autopilot Demo (piloto)
# npm run seed:test   # CI/e2e

# API (workers in-process por default)
npm run start:dev

# Opcional: worker separado
# ASYNC_WORKERS_IN_API=false npm run start:dev
# npm run start:worker:dev
```

Stack só Docker (API containerizada):

```bash
cd apps/api
docker compose up -d
```

Verificação:

```bash
curl -sS http://localhost:3001/health
curl -sS http://localhost:3001/health/ready
open http://localhost:3001/docs   # Swagger
```

---

## 12. Fluxo completo de onboarding de uma nova empresa

### Realidade atual (API)

Não há `POST /auth/register`. Há dois caminhos:

#### A) Seed / ops (mais usado hoje)

1. Rodar seed (`local` / `pilot` / `demo`) → Company + Users ACTIVE + Memberships  
2. `POST /api/auth/login`  
3. `POST /api/auth/select-company` `{ companySlug }`  
4. `POST /api/whatsapp/connect` → QR / CONNECTED (Evolution)  
5. `POST /api/leads` → primeiro lead  
6. Inbound webhook ou `POST /api/whatsapp/send` → primeira mensagem  
7. Opcional: `GET /api/setup/status` (checklist company / whatsapp / firstLead / firstMessage)

#### B) Setup wizard (API piloto — parcial)

1. **Pré-requisito:** User já existe e está `ACTIVE` com senha (não há signup público)  
2. `POST /api/auth/login` (sem company)  
3. `POST /api/setup/company` `{ name, slug?… }` → Company + membership OWNER  
   - Limite piloto: **1 company por user** (`SETUP_COMPANY_LIMIT`)  
4. `POST /api/auth/select-company`  
5. Conectar WhatsApp, criar lead, enviar/receber mensagem (endpoints existentes)  
6. Convidar equipe: `POST /api/memberships` → User `PENDING` + Membership `INVITED`, **sem e-mail e sem senha** → convidado **não consegue logar** até fluxo futuro

**Gap crítico de onboarding cliente:** registro + convite com set-password/e-mail + UI do wizard.

---

## 13. URLs disponíveis após bootstrap

Base default: `http://localhost:3001`

### Públicas (sem prefixo `api`)

| URL | Descrição |
|---|---|
| `GET /health` | Health simples |
| `GET /health/live` | Liveness |
| `GET /health/ready` | Postgres + Redis |
| `GET /metrics` | Prometheus |
| `GET /docs` | Swagger UI (se `SWAGGER_ENABLED`) |
| `GET /docs-json` | OpenAPI JSON |

### API (`/api/...`) — principais

| Grupo | Exemplos |
|---|---|
| Auth | `/api/auth/login`, `select-company`, `refresh`, `logout`, `logout-all`, `me` |
| Setup | `/api/setup/status`, `/api/setup/company` |
| Settings | `/api/settings/company` |
| Memberships / Users | `/api/memberships`, `/api/users/:id/sessions\|logout-all\|revoke-access` |
| Leads / CRM | `/api/leads`, `…/timeline`, `…/notes`, `…/activities`, assign/bulk |
| Conversations | `/api/conversations`, `…/messages` |
| WhatsApp | `/api/whatsapp/connect\|status\|disconnect\|send`, webhook `/api/whatsapp/webhook/:instanceKey` |
| AI | `/api/ai/conversations/:id/suggest` |
| Follow-ups | `/api/follow-ups` + approve/execute/… |
| Dashboard / Pipeline | `/api/dashboard/*`, `/api/pipeline` |
| Exports | `/api/exports/leads\|activities\|followups` |
| Ops / Audit | `/api/ops/*`, `/api/audit` |

---

## 14. Prints ou descrição das telas existentes

**Não há telas de produto.** Não é possível anexar prints de UI de app.

Única “interface” visual no bootstrap local:

### Swagger UI (`/docs`)

- Lista tags: auth, leads, whatsapp, ai, follow-ups, dashboard, ops, setup, etc.
- Authorize Bearer JWT
- Try-it-out nos endpoints
- Em produção pode exigir Basic Auth (`SWAGGER_USER` / `SWAGGER_PASSWORD`)

### Prisma Studio (opcional, não é produto)

```bash
npm run prisma:studio
```

Inspector de tabelas para dev — não é painel Autopilot.

### O que um usuário veria hoje

1. Navegador em `/docs` → catálogo OpenAPI  
2. Ou cliente HTTP customizado  
3. **Nenhuma** tela de login branded, inbox, kanban, settings UI, etc.

---

## 15. O que falta para um piloto real com clientes

### Bloqueadores de experiência (P0 produto)

| Gap | Por quê |
|---|---|
| **Frontend web** | Clientes não usam Swagger |
| **Signup / aceite de convite** | Sem registro; INVITED sem senha/e-mail |
| **SMTP / notificações** | Convites e resets não saem do sistema |
| **Evolution + OpenAI reais** | Stub só para dev/test; piloto precisa credenciais e rede |
| **Domínio público + HTTPS + webhook Evolution** | Inbound WhatsApp exige URL alcançável (`API_PUBLIC_URL`) |

### Altamente recomendado antes/ durante piloto

| Gap | Notas |
|---|---|
| UI do setup wizard | API `setup/*` existe; sem UX |
| Painel ops/dashboard visual | APIs prontas; sem UI |
| Rotação de senhas seed | `Demo@12345` inaceitável em piloto exposto |
| Observabilidade em prod | OTEL off por default; alertas Ops via API |
| Política de async flags | Definir se workers ON em piloto |
| Storage de logo | Só URL string; sem upload |
| Multi-company / limites | Setup limita 1 company/user (decisão piloto) |
| Termos, LGPD, auditoria legal UX | Audit API existe; compliance UI não |

### Já existe e ajuda o piloto (API)

- Auth multi-tenant + RLS  
- WhatsApp connect/send/webhook  
- Leads, conversas, follow-ups, AI suggest  
- CRM notes/activities/timeline/pipeline  
- Memberships, settings, exports CSV  
- Diagnostics, runbooks, seed piloto, e2e críticos, feedback log (modo manutenção)

### Veredito

| Pergunta | Resposta |
|---|---|
| Dá para demo técnica / UAT via API? | **Sim** (Swagger + seeds) |
| Dá para piloto com clientes finais (lojas/oficinas)? | **Não de forma autônoma** — falta frontend + onboarding de usuário + e-mail + Evolution/OpenAI em produção |
| Próximo investimento natural | UI (web) + invite/set-password + SMTP; manter API em manutenção/bugfix |

---

## Apêndice A — Contornos do “monorepo”

O README declara monorepo preparado; na prática é **repo com uma app**. Não há tooling de workspace. Adicionar `apps/web` será o primeiro segundo pacote real.

## Apêndice B — Documentação relevante

| Doc | Uso |
|---|---|
| `docs/go-live-checklist.md` | Checklist piloto |
| `docs/performance-baseline.md` | Baseline local |
| `docs/runbooks/*` | Incidentes |
| `docs/pilot-stabilization-review.md` | Estado pós-10.5 |
| `docs/pilot-enablement-review.md` | Settings/memberships/setup API |
| `docs/local-bootstrap.md` | Bootstrap local (parcialmente datado vs seeds atuais) |
| Root `README.md` / `apps/api/README.md` | Setup; README da API ainda diz “fundação” (desatualizado vs código) |

---

**Fim da auditoria.** Nenhuma alteração de código de produto foi feita além deste relatório.
