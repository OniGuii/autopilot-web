# AutoPilot

Plataforma SaaS de recuperação e conversão de leads com Inteligência Artificial.

Foco inicial: lojas de veículos, revendas e oficinas mecânicas.

## Monorepo (preparado)

```text
apps/
└── api/     # Backend NestJS (fundação atual)
# apps/web  # Frontend Next.js — ainda não criado
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
