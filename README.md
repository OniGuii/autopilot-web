# AutoPilot

Plataforma SaaS de recuperação e conversão de leads com Inteligência Artificial.

Foco inicial: lojas de veículos, revendas e oficinas mecânicas.

## Monorepo

```text
apps/
├── api/     # Backend NestJS
└── web/     # Frontend Next.js 15 (Sprint 1: login, empresa, dashboard, leads)
docs/
├── frontend-architecture.md
└── frontend-sprint1-review.md
```

## Backend

Documentação e setup: [`apps/api/README.md`](./apps/api/README.md)

```bash
cd apps/api
cp .env.example .env
npm install
npm run start:dev
```

- Health: `http://localhost:3001/health`
- Swagger: `http://localhost:3001/docs`

## Frontend

Setup: [`apps/web/README.md`](./apps/web/README.md)

```bash
cd apps/web
cp .env.example .env.local
npm install
npm run dev
```

- App: `http://localhost:3000/login`
- Proxy da API: `http://localhost:3000/backend/*` → `localhost:3001`
