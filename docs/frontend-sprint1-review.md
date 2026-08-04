# Frontend Sprint 1 — Review

**Branch:** `cursor/frontend-sprint1-dd93`  
**App:** `apps/web`  
**Data:** 2026-08-04  
**Escopo:** Login · Select Company · Dashboard · Leads  

---

## 1. Entrega

| Item | Status |
|------|--------|
| Scaffold `apps/web` (Next.js 15 + TypeScript + App Router) | OK |
| Tailwind CSS + componentes Shadcn-style (Radix) | OK |
| TanStack Query | OK |
| React Hook Form + Zod | OK |
| Login | OK |
| Select Company | OK |
| Dashboard | OK |
| Leads (lista, criação, detalhe/edição) | OK |
| Módulos fora do Sprint 1 | Não implementados |
| Alterações em `apps/api` | Nenhuma |
| Novas APIs | Nenhuma |

---

## 2. Contratos reais da API (ajustes vs arquitetura)

A implementação consumiu os **contratos atuais** de `apps/api`, não os nomes genéricos do doc de arquitetura quando divergiam:

| Doc arquitetura (aproximado) | API real usada |
|------------------------------|----------------|
| `POST /api/auth/select-company` `{ companyId }` | `{ companySlug }` |
| `GET /api/dashboard/summary` | `GET /api/dashboard` (payload full: overview, leads.byStatus, conversations, followUps) |
| Lead `temperature` | **não existe** no DTO/modelo atual |
| Roles / JWT `cid` | Confirmado: login sem `cid` → select-company emite tokens com company bound |

---

## 3. Estrutura criada (Sprint 1)

```text
apps/web/src/
├── app/
│   ├── (public)/login|logout
│   ├── (auth)/select-company
│   ├── (app)/dashboard|leads|leads/[leadId]
│   ├── layout.tsx · page.tsx · globals.css
│   └── middleware.ts
├── components/{ui,layout,auth}
├── features/{auth,dashboard,leads}
├── lib/{api,auth,format,utils}
└── providers/{auth-provider,query-provider}
```

Proxy same-origin: `next.config.ts` rewrites `/backend/:path*` → `API_INTERNAL_URL` (default `http://localhost:3001`), evitando CORS **sem** alterar a API.

---

## 4. Fluxo validado

Credenciais seed local:

- e-mail: `owner@local.autopilot.dev`
- senha: `Demo@12345`
- slug: `local-demo`

### 4.1 API direta (`localhost:3001`)

| Passo | Resultado |
|-------|-----------|
| `POST /api/auth/login` | tokens + 1 membership (`local-demo`) |
| `POST /api/auth/select-company` `{ companySlug }` | tokens com company `AutoPilot Local` |
| `GET /api/dashboard` | `totalLeads=50`, `openConversations=41` |
| `GET /api/leads?page=1&limit=5` | `total=50` |
| `GET /api/auth/me` | `OWNER` + company `local-demo` |

### 4.2 Via proxy Next (`localhost:3000/backend`)

| Passo | Resultado |
|-------|-----------|
| Login / select-company / dashboard / leads | OK |
| `POST /api/leads` (criação) | OK (`Lead Sprint1 Validacao`) |
| `GET /backend/health` | `200` |

### 4.3 Rotas UI + middleware

| Rota | Sem sessão | Com sessão, sem company | Com company |
|------|------------|-------------------------|-------------|
| `/login` | 200 | — | — |
| `/select-company` | 307 → `/login` | 200 | 307 → `/dashboard` |
| `/dashboard` | 307 → `/login` | 307 → `/select-company` | 200 |
| `/leads` | 307 → `/login` | 307 → `/select-company` | 200 |

Fluxo de produto: **login → select-company → dashboard → leads**.

---

## 5. Build

```bash
cd apps/web
NODE_ENV=production npm run build   # também via npm run build
```

**Resultado:** sucesso (Next.js 15.5.9).

Rotas geradas: `/`, `/login`, `/logout`, `/select-company`, `/dashboard`, `/leads`, `/leads/[leadId]`.

> Nota de ambiente: se `NODE_ENV=development` estiver exportado globalmente, o `next build` pode falhar com erro de `<Html>`. O script `build` força `NODE_ENV=production`.

---

## 6. Endpoints consumidos (Sprint 1)

| Método | Path | Uso |
|--------|------|-----|
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/select-company` | Bind empresa |
| `GET` | `/api/auth/me` | Sessão / shell |
| `POST` | `/api/auth/refresh` | Refresh silencioso |
| `POST` | `/api/auth/logout` | Logout |
| `GET` | `/api/dashboard` | Dashboard |
| `GET` | `/api/leads` | Lista + filtros |
| `POST` | `/api/leads` | Criar |
| `GET` | `/api/leads/:id` | Detalhe |
| `PATCH` | `/api/leads/:id` | Editar |

---

## 7. Fora do escopo (próximos sprints)

Conversations, FollowUps, Pipeline, WhatsApp, AI Assist, Memberships, Settings, Exports, Ops, Setup wizard, notes/activities/timeline/assign/bulk.

---

## 8. Como reproduzir

```bash
# API
cd apps/api && npm run start:dev
# (seed se necessário) npm run seed:local

# Web
cd apps/web && cp .env.example .env.local && npm install && npm run dev
# abrir http://localhost:3000/login
```

---

## 9. Riscos / débitos técnicos

1. Tokens em `localStorage` + cookies de gate (`autopilot_has_session` / `autopilot_has_company`) — adequado a piloto; endurecer com BFF HttpOnly depois.
2. Seed `pilot` falhou neste ambiente por RLS em `follow_ups`; validação usou `seed:local` (sem mudança de código na API).
3. UI de Sprint 1 é funcional e alinhada ao shell da arquitetura; design system completo fica para iterações seguintes.
4. Troca de empresa no topbar não foi implementada (apenas select pós-login).
