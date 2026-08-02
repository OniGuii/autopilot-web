# Local Bootstrap — AutoPilot API

**Status:** Guia de execução local (comandos preparados; **não executados** nesta etapa)  
**Objetivo:** Validar a fundação completa (schema + migrations + seeds + Docker) antes do Auth

---

## 1. Revisão final da fundação

| Artefato | Estado | Notas |
|---|---|---|
| `prisma/schema.prisma` | ✅ | 9 models, 8 enums, pacote RECOMMENDED (A+B) |
| Migration M1 `init_mvp` | ✅ gerada | Enums, tabelas, FKs, índices, `users.email` unique |
| Migration M2 `partial_uniques` | ✅ gerada | 4 partial unique indexes |
| Seeds `local` / `demo` / `test` | ✅ código pronto | Idempotentes, dados fake |
| Tenant / soft-delete extensions | ✅ scaffolds | **Não** ativadas |
| Auth / APIs de domínio | ❌ fora | Próximas etapas |

---

## 2. Requisitos

| Requisito | Versão sugerida |
|---|---|
| Node.js | 22+ |
| npm | 10+ |
| Docker + Docker Compose | Engine 24+ / Compose v2 |
| Porta livre | `5432` (Postgres), `6379` (Redis), `3001` (API) |
| Git | clone do repositório |

Opcional: `psql` client para inspeção manual.

---

## 3. Setup inicial (uma vez)

```bash
cd apps/api

# Dependências
npm install

# Ambiente
cp .env.example .env
# Conferir DATABASE_URL e Redis apontando para localhost

# Prisma Client
npx prisma generate
# (também roda no postinstall)
```

`.env` mínimo:

```env
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://autopilot:autopilot@localhost:5432/autopilot?schema=public
REDIS_HOST=localhost
REDIS_PORT=6379
```

---

## 4. Docker — Postgres + Redis

`docker-compose.yml` define:

| Serviço | Imagem | Porta host | Credenciais |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `5432` | user/pass/db = `autopilot` |
| `redis` | `redis:7-alpine` | `6379` | sem senha (local) |
| `api` | build local | `3001` | opcional; dev costuma rodar API no host |

### Subir só infra (recomendado no dia a dia)

```bash
npm run db:start
# Preferência: Docker Compose (postgres + redis)
# Fallback: Postgres/Redis nativos (ex.: agentes cloud sem Docker)
```

### Parar infra

```bash
npm run db:stop
# Docker: stop postgres/redis
# Nativo: mantém serviços; ver dica no script
```

### Healthcheck Postgres

```bash
docker compose ps
docker compose exec postgres pg_isready -U autopilot -d autopilot
```

---

## 5. Prisma — migrate e seed

> Executar **somente após aprovação** desta etapa.

### Aplicar migrations (M1 + M2)

```bash
npm run db:migrate
# = prisma migrate deploy
```

### Reset local (apaga dados do schema e reaplica migrations)

```bash
npm run db:reset
# = prisma migrate reset --force --skip-seed
# Depois rode o seed desejado manualmente
```

### Seeds

```bash
npm run db:seed:local   # 1 company, 3 users, 50 leads
npm run db:seed:demo    # 2 companies, 5 users, 200 leads
npm run seed:test       # fixture mínima (também disponível)
```

### Studio (opcional)

```bash
npm run prisma:studio
```

---

## 6. Comandos completos (fluxo feliz)

```bash
cd apps/api
cp -n .env.example .env
npm install

npm run db:start
# aguardar postgres healthy

npm run db:migrate
npm run db:seed:local

npm run start:dev
# http://localhost:3001/health
# http://localhost:3001/docs
```

Fluxo demo comercial:

```bash
npm run db:reset
npm run db:seed:demo
npm run start:dev
```

---

## 7. Scripts npm (`package.json`)

| Script | Comando real | Propósito |
|---|---|---|
| `db:start` | `docker compose up -d postgres redis` | Sobe Postgres + Redis |
| `db:stop` | `docker compose stop postgres redis` | Para containers |
| `db:reset` | `prisma migrate reset --force --skip-seed` | Recria schema (sem seed) |
| `db:migrate` | `prisma migrate deploy` | Aplica M1 + M2 |
| `db:seed:local` | `npm run seed:local` | Seed desenvolvimento |
| `db:seed:demo` | `npm run seed:demo` | Seed demonstração |

Aliases existentes mantidos: `seed:local`, `seed:demo`, `seed:test`, `prisma:generate`, `prisma:studio`.

---

## 8. Checklist de execução (após aprovação)

### Pré

- [ ] Docker rodando
- [ ] Portas 5432 / 6379 / 3001 livres
- [ ] `cd apps/api && cp -n .env.example .env`
- [ ] `npm install`
- [ ] `npx prisma validate`

### Infra

- [ ] `npm run db:start`
- [ ] `docker compose exec postgres pg_isready -U autopilot -d autopilot`

### Dados

- [ ] `npm run db:migrate`
- [ ] `npx prisma migrate status` → M1 e M2 applied
- [ ] Conferir partial uniques (`\di *uq_*` via psql) — opcional
- [ ] `npm run db:seed:local`
- [ ] Re-run `npm run db:seed:local` (idempotência)

### App

- [ ] `npm run start:dev`
- [ ] `curl -s http://localhost:3001/health` → `status: ok`
- [ ] Abrir `http://localhost:3001/docs`

### Encerrar

- [ ] Parar API (`Ctrl+C`)
- [ ] `npm run db:stop` (dados do volume Postgres permanecem)

---

## 9. Troubleshooting rápido

| Problema | Ação |
|---|---|
| porta 5432 em uso | Parar outro Postgres ou mudar porta no compose/`.env` |
| `P1001` can't reach database | `npm run db:start` + checar `DATABASE_URL` |
| migrate falha | DB vazio? Ver logs; não editar migrations aplicadas |
| seed falha com unique | Garantir M2 applied; ou `db:reset` + seed de novo |
| `postinstall` prisma generate falha | Rodar `npx prisma generate` manualmente |

---

## 10. Fora desta etapa

- Executar migrate / seed / conectar banco (aguarda aprovação)
- Auth
- Ativar Prisma extensions
- Alterar domínio / schema

---

**Aguardar aprovação antes de qualquer execução real no ambiente local.**
