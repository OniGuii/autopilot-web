# AutoPilot API

Backend NestJS da plataforma AutoPilot — recuperação e conversão de leads com IA.

> Fundação arquitetural apenas. Sem regras de negócio, entidades ou CRUDs nesta etapa.

## Stack

- NestJS 11 + TypeScript
- Prisma + PostgreSQL
- Redis (Docker; BullMQ ainda não implementado)
- Swagger (`/docs`)
- Jest

## Pré-requisitos

- Node.js 22+
- npm 10+
- Docker (opcional, para Postgres/Redis)

## Setup

```bash
cp .env.example .env
npm install
npx prisma generate
npm run start:dev
```

API: `http://localhost:3001`  
Health: `http://localhost:3001/health`  
Swagger: `http://localhost:3001/docs`

## Docker (infra local)

```bash
docker compose up -d postgres redis
# ou stack completa:
docker compose up -d
```

## Scripts

| Script | Descrição |
|---|---|
| `npm run start:dev` | Dev com watch |
| `npm run build` | Build de produção |
| `npm run start:prod` | Executa `dist` |
| `npm test` | Testes unitários |
| `npm run test:e2e` | Testes e2e |
| `npx prisma generate` | Gera Prisma Client |

## Estrutura

Ver [Architecture.md](./Architecture.md) e [Roadmap.md](./Roadmap.md).  
Princípios de dados: [docs/database-principles.md](./docs/database-principles.md).
