# @autopilot/web

Frontend SaaS Autopilot (Next.js 15 + TypeScript) — Sprint 1.

## Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS + componentes estilo Shadcn UI
- TanStack Query
- React Hook Form + Zod

## Sprints

**Sprint 1:** Login, Select Company, Dashboard, Leads  

**Sprint 2:** Conversations, Messages, WhatsApp (connect/status), Follow-ups (approve/reject/execute/reschedule)

## Setup

```bash
cd apps/web
cp .env.example .env.local
npm install
npm run dev
```

A API deve estar em `http://localhost:3001`. O browser chama `/backend/*`, reescrito para a API (evita CORS sem alterar `apps/api`).

## Scripts

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Dev server (porta 3000) |
| `npm run build` | Build de produção |
| `npm run start` | Serve o build |
| `npm run lint` | ESLint |

Credenciais locais (seed API): `owner@local.autopilot.dev` / `Demo@12345`.
