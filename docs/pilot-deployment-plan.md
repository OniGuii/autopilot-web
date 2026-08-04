# Plano de Deploy do Piloto — Autopilot

**Tipo:** auditoria operacional (somente documentação — sem implementação)  
**Data:** 2026-08-04  
**Repositório:** `autopilot-web`  
**Apps:** `apps/api` (NestJS) · `apps/web` (Next.js 15, Sprints 1–2)  
**Fontes:** `.env.example`, `configuration.ts`, `env.validation.ts`, migrations RLS, Dockerfiles, runbooks, `go-live-checklist.md`

---

## Sumário executivo

Para operação real do piloto é obrigatório provisionar **Postgres**, **Redis**, **Evolution API** (WhatsApp), **OpenAI**, e hospedar **API + Web** com URL pública HTTPS (webhook). O código **não integra Supabase SDK/Auth/Storage** — Postgres pode (e deve, se escolhido) ser o **Supabase Database** via `DATABASE_URL`.

O `docker-compose.yml` atual em `apps/api` é de **desenvolvimento** (credenciais fracas, portas expostas). Este documento especifica a configuração de produção e checklists de go-live.

**Gaps que bloqueiam “cliente final 100% self-serve” (já conhecidos):**

- Sem signup público de usuário (só login + setup company para user já existente)
- Convites `INVITED` sem envio de e-mail / sem senha temporária
- Sem SMTP / storage de arquivos
- API sem `enableCors` — o web usa proxy `/backend` (Next rewrite); em produção o proxy ou um reverse-proxy precisa continuar cobrindo isso

---

## 1. Todas as variáveis obrigatórias do `.env`

### 1.1 Classificação

| Classe | Significado |
|--------|-------------|
| **OBRIGATÓRIA** | Validação Joi / boot falha ou produto inutilizável em prod |
| **OBRIGATÓRIA PILOTO REAL** | App sobe sem ela, mas canal/IA/webhook quebram |
| **RECOMENDADA** | Defaults existem; ajustar para prod |
| **OPCIONAL** | Tuning / observabilidade |

### 1.2 Core (API) — obrigatórias

| Variável | Classe | Notas |
|----------|--------|-------|
| `NODE_ENV` | OBRIGATÓRIA | `production` no piloto |
| `DATABASE_URL` | OBRIGATÓRIA | Postgres; Prisma |
| `JWT_ACCESS_SECRET` | OBRIGATÓRIA | ≥32 chars; **proibido** fallback `dev-only-access-secret-change-me` |
| `JWT_ACCESS_TTL` | RECOMENDADA | default `15m` |
| `JWT_REFRESH_TTL_DAYS` | RECOMENDADA | default `7` |
| `PORT` | RECOMENDADA | default `3001` |
| `API_PREFIX` | RECOMENDADA | default `api` |
| `API_PUBLIC_URL` | **OBRIGATÓRIA PILOTO REAL** | URL HTTPS pública da API; usada no webhook Evolution: `{API_PUBLIC_URL}/api/whatsapp/webhook/{instanceKey}` |
| `REDIS_HOST` | OBRIGATÓRIA (prático) | default `localhost` — em prod deve apontar para Redis real |
| `REDIS_PORT` | RECOMENDADA | default `6379` |
| `REDIS_PASSWORD` | **OBRIGATÓRIA PILOTO REAL** | senha forte; vazio só em lab |

### 1.3 Canais externos — obrigatórias para piloto real

| Variável | Classe | Notas |
|----------|--------|-------|
| `EVOLUTION_API_URL` | **OBRIGATÓRIA PILOTO REAL** | Em `production` **sem** URL → stub **proibido** (connect/send falham) |
| `EVOLUTION_API_KEY` | **OBRIGATÓRIA PILOTO REAL** | Header Evolution |
| `EVOLUTION_INSTANCE` | OPCIONAL | legado/nome; instâncias são criadas por company |
| `OPENAI_API_KEY` | **OBRIGATÓRIA PILOTO REAL** (se IA for usada) | Sem key fora de `test` → `503 OpenAI API key is not configured` |
| `OPENAI_MODEL` | RECOMENDADA | default `gpt-4o-mini` |

### 1.4 Segurança / Swagger / throttle

| Variável | Classe | Notas |
|----------|--------|-------|
| `SWAGGER_ENABLED` | RECOMENDADA | default off em production; se `true`, exigir user/pass |
| `SWAGGER_USER` / `SWAGGER_PASSWORD` | OBRIGATÓRIA se Swagger on em prod | |
| `THROTTLE_TTL_MS` | RECOMENDADA | default `60000` |
| `THROTTLE_LIMIT` | RECOMENDADA | default `120` |
| `THROTTLE_AUTH_LIMIT` | RECOMENDADA | default `20` |
| `AUTH_MAX_SESSIONS_PER_USER` | RECOMENDADA | default `5` |
| `AUTH_MEMBERSHIP_CACHE_TTL_SECONDS` | RECOMENDADA | default `30` |

### 1.5 Async / workers (defaults = sync / off)

| Variável | Default | Recomendação piloto |
|----------|---------|---------------------|
| `ASYNC_WORKERS_IN_API` | `true` | `true` (single node) **ou** `false` + processo `start:worker` |
| `ASYNC_INBOUND_ENABLED` | `false` | `true` se tráfego webhook relevante |
| `ASYNC_FOLLOWUP_ENABLED` | `false` | `true` se quiser execução automática de due follow-ups |
| `ASYNC_RECONCILE_ENABLED` | `false` | `true` em piloto estável |
| `ASYNC_AI_ENABLED` | `false` | `false` no início (suggest sync); `true` sob carga |
| `ASYNC_OUTBOUND_ENABLED` | `false` | `false` no início; `true` sob carga de envio |

Demais: `ASYNC_INBOUND_ATTEMPTS`, `QUEUE_*`, `WEBHOOK_*`, `FOLLOWUP_SCHEDULER_*`, `RECONCILE_*`, `AI_SUGGEST_*`, `OUTBOUND_*`, `OPS_RECONCILE_TAKE`, timeouts Evolution / circuit breaker — ver `apps/api/.env.example` (todas RECOMENDADAS com defaults).

### 1.6 Observabilidade

| Variável | Default | Notas |
|----------|---------|-------|
| `METRICS_ENABLED` | `true` | `/metrics` Prometheus |
| `OTEL_ENABLED` | `false` | opcional |
| `OTEL_SERVICE_NAME` | `autopilot-api` | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | se OTEL on |
| `LOG_FORMAT` | json em prod | `json` \| `pretty` |
| `OBS_*` | ver `.env.example` | alertas Ops/DB |

### 1.7 Seed (NÃO usar em prod real)

| Variável | Notas |
|----------|-------|
| `SEED_PROFILE` | `local` \| `demo` \| `test` \| `pilot` |
| `ALLOW_PROD_SEED` | Só `true` em emergência controlada; **nunca** em cliente real |

### 1.8 Frontend (`apps/web`)

| Variável | Classe | Notas |
|----------|--------|-------|
| `NEXT_PUBLIC_API_BASE_URL` | OBRIGATÓRIA | Em prod tipicamente `/backend` (same-origin) |
| `API_INTERNAL_URL` | OBRIGATÓRIA | URL interna da API para rewrite Next (ex. `http://api:3001`) |
| `NEXT_PUBLIC_APP_URL` | RECOMENDADA | URL pública do SaaS |

### 1.9 Matriz mínima de boot piloto (API)

```bash
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_ACCESS_SECRET=<random ≥32>
REDIS_HOST=...
REDIS_PORT=6379
REDIS_PASSWORD=...
API_PUBLIC_URL=https://api.seu-dominio.com
EVOLUTION_API_URL=https://evolution.seu-dominio.com
EVOLUTION_API_KEY=...
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
SWAGGER_ENABLED=false
ALLOW_PROD_SEED=   # unset / false
```

---

## 2. Quais serviços externos precisam ser criados

| Serviço | Obrigatório? | Uso no Autopilot |
|---------|--------------|------------------|
| **PostgreSQL 16+** (Supabase ou managed) | Sim | Dados + RLS |
| **Redis 7+** | Sim | BullMQ, cache auth, locks AI |
| **Evolution API** (self-host ou managed) | Sim (WhatsApp real) | QR, send, webhooks |
| **OpenAI API** | Sim (se IA no piloto) | `POST /api/ai/conversations/:id/suggest` |
| **DNS + TLS** (API + Web + Evolution) | Sim | HTTPS público |
| **Reverse proxy** (Caddy/Nginx/Traefik/Cloud LB) | Sim | TLS, roteamento |
| **Hospedagem container** (VM/Docker/K8s/Fly/Render) | Sim | API, web, worker, Evolution |
| **Supabase Auth / Storage / Realtime / Edge** | **Não usado pelo código** | Não criar como dependência do app |
| **SMTP / SendGrid / SES** | Não (gap) | Convites sem e-mail hoje |
| **Object storage (S3)** | Não | Sem uploads |
| **OTEL collector** | Opcional | Se `OTEL_ENABLED=true` |
| **Prometheus/Grafana** | Opcional | Scraping `/metrics` |
| **Backup offsite** | Sim | Postgres (+ Redis AOF se crítico) |

---

## 3. Configuração completa do Supabase

> **Estado do código:** zero referências a `supabase` SDK. Supabase entra só como **host Postgres** (e dashboard). Auth do Autopilot é JWT próprio (Nest + Prisma).

### 3.1 Projeto

1. Criar projeto Supabase (região próxima aos usuários piloto).
2. Desabilitar uso de Supabase Auth no produto Autopilot (não conectar frontend ao GoTrue).
3. Não depender de Storage/Realtime para o piloto.

### 3.2 Connection strings

No dashboard: **Project Settings → Database**.

| Uso | String | Variável |
|-----|--------|----------|
| Runtime Prisma (pooler, porta 6543 / Supavisor) | `postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&schema=public` | `DATABASE_URL` |
| Migrations (`prisma migrate deploy`) | Direct: porta **5432** host `db.[ref].supabase.co` | Preferir `DIRECT_URL` se adicionado no schema; **hoje o schema só tem `DATABASE_URL`** — rodar migrate com URL direta temporariamente |

**Atenção Prisma + pooler:**

- Preferir transaction mode pooler para queries da app
- Migrations e `prisma migrate deploy` **exigem conexão direta** (não PgBouncer transaction mode)

### 3.3 Roles e RLS Autopilot vs Supabase

O Autopilot aplica **FORCE RLS** próprio com GUCs:

- `app.company_id` (UUID)
- `app.rls_bypass` (`on`/`off`)

Policies: `tenant_isolation` em `leads`, `conversations`, `messages`, `follow_ups`, `events`, `audit_logs`, `webhook_events`, `lead_notes`, `lead_activities`; policies especiais em `whatsapp_instances`.

**Não** sobrepor com policies genéricas do “Supabase Auth `auth.uid()`” nas tabelas do Autopilot.

Recomendações:

1. Rodar migrate com role `postgres` (ou role com bypass controlado).
2. App deve conectar com role que **não** é bypass implícito de RLS owner — o código usa `FORCE ROW LEVEL SECURITY` + `SET LOCAL` por transação.
3. Seeds usam `set_config('app.rls_bypass','on')` — **nunca** em rotina de prod.

### 3.4 Extensões / parâmetros

- Postgres 15/16 compatível com migrations atuais
- Garantir que `set_config` / GUCs custom `app.*` são permitidos (são session settings, não exigem extensão)
- Connection limit: dimensionar pool Prisma + pooler (API + worker)

### 3.5 Rede

- Allowlist IPs da API/worker se usando network restrictions
- SSL obrigatório (`sslmode=require` na URL se necessário)

### 3.6 Backup Supabase

- Ativar PITR se plano permitir
- Export lógico semanal adicional (ver §8)

---

## 4. Configuração completa do Redis

### 4.1 Papel

| Uso | Detalhe |
|-----|---------|
| BullMQ | Filas inbound, followup, reconcile, AI, outbound, DLQ |
| Auth cache | keys `autopilot:auth:access:*` |
| Locks / rate | AI suggest etc. |

Sem Redis: `/health/ready` degrada; workers/filas indisponíveis.

### 4.2 Provisionamento piloto

```text
Redis 7+
maxmemory-policy: noeviction   # preferível com BullMQ (não expulsar jobs)
appendonly yes                 # AOF
requirepass <forte>
bind privado / VPC only
TLS se managed (Upstash/ElastiCache/Memorystore)
```

Env API:

```bash
REDIS_HOST=redis.internal
REDIS_PORT=6379
REDIS_PASSWORD=<forte>
```

### 4.3 Topologia

| Modo | Config |
|------|--------|
| Single node piloto | Redis 1 instância + API com `ASYNC_WORKERS_IN_API=true` |
| Separar workers | Mesmo Redis; API `ASYNC_WORKERS_IN_API=false` + `node dist/worker.main` |

### 4.4 Não fazer

- Não `FLUSHALL` em incidente sem plano de reconcile
- Não usar Redis efêmero sem AOF se async estiver ligado
- Não expor porta 6379 na internet

### 4.5 Validação

```bash
redis-cli -h "$REDIS_HOST" -a "$REDIS_PASSWORD" PING
curl -sS "$API_PUBLIC_URL/health/ready"
# diagnostics → checks.redis
```

---

## 5. Configuração completa da Evolution

### 5.1 Papel

Evolution API (Baileys) para:

- Criar instância + QR (`POST /api/whatsapp/connect`)
- Enviar texto (`POST /api/whatsapp/send` / execute follow-up)
- Receber eventos no webhook Autopilot

### 5.2 Env Autopilot

```bash
EVOLUTION_API_URL=https://evolution.seu-dominio.com
EVOLUTION_API_KEY=<global api key Evolution>
API_PUBLIC_URL=https://api.seu-dominio.com   # crítico
```

Em `NODE_ENV=production`, URL vazia **não** entra em stub.

### 5.3 Webhook registrado pela API

URL gerada no connect:

```text
{API_PUBLIC_URL}/api/whatsapp/webhook/{instanceKey}
```

Header exigido: `X-Webhook-Secret` (secret gerado no connect; hash no DB).

Requisitos:

1. `API_PUBLIC_URL` HTTPS alcançável pela Evolution
2. Sem auth básica no path do webhook (secret no header)
3. Timeout adequado; se `ASYNC_INBOUND_ENABLED=true`, API enfileira e responde rápido

### 5.4 Deploy Evolution (checklist)

- [ ] Container Evolution v2 (ou versão alinhada aos endpoints usados: `/instance/create`, QR, send text, set webhook)
- [ ] Persistência de sessões WhatsApp (volume)
- [ ] `AUTHENTICATION_API_KEY` = `EVOLUTION_API_KEY`
- [ ] Rede: Evolution → API pública; API → Evolution interna/pública
- [ ] Não reutilizar secrets do seed piloto (`pilot-webhook-secret-demo-only`)

### 5.5 Tuning já suportado no Autopilot

Timeouts, retries, circuit breaker: `EVOLUTION_TIMEOUT_*`, `EVOLUTION_RETRY_*`, `EVOLUTION_CB_*`, `WEBHOOK_MAX_INFLIGHT`, `WEBHOOK_SLOW_MS`.

### 5.6 Validação

```bash
curl -sS -H "Authorization: Bearer $TOKEN" "$API/api/whatsapp/connect"
curl -sS -H "Authorization: Bearer $TOKEN" "$API/api/whatsapp/status"
# diagnostics → whatsapp / evolution.circuit / stubMode=false
```

---

## 6. Configuração completa da OpenAI

### 6.1 Papel

`OpenAiClient.chatCompletion` usado por AI suggest → cria `FollowUp` `SUGGESTED` (`AI_REPLY`).

Endpoint: `POST /api/ai/conversations/:conversationId/suggest`

### 6.2 Env

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini          # ou modelo aprovado no piloto
AI_SUGGEST_TIMEOUT_MS=25000
# se async:
ASYNC_AI_ENABLED=false            # começar sync
AI_SUGGEST_CONCURRENCY=2
AI_FAILURE_RATE_THRESHOLD=0.5
```

### 6.3 Comportamento

| Ambiente | Sem key |
|----------|---------|
| `test` | stub determinístico |
| `development` / `production` | **503** |

### 6.4 Conta OpenAI

- [ ] Projeto/org com billing ativo
- [ ] Limite de rate adequado ao piloto
- [ ] Key só no secret store da API/worker (nunca no `NEXT_PUBLIC_*`)
- [ ] Monitorar usage + falhas em `/api/ops/diagnostics` (OWNER full)

### 6.5 Validação

```bash
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$API/api/ai/conversations/$CONVERSATION_ID/suggest" -d '{}'
# espera FollowUp SUGGESTED ou accepted+jobId se ASYNC_AI_ENABLED
```

---

## 7. Docker Compose de produção

> **Não existe** `docker-compose.prod.yml` no repo. O compose atual (`apps/api/docker-compose.yml`) é lab. Abaixo: **especificação recomendada** (documentação).

### 7.1 Serviços

| Serviço | Imagem / build | Porta publicada |
|---------|----------------|-----------------|
| `api` | build `apps/api/Dockerfile` | 3001 (só rede interna + proxy) |
| `worker` | mesmo image, cmd `node dist/worker.main` | — |
| `web` | build Next standalone (a especificar no deploy) | 3000 interno |
| `postgres` | **omitir** se Supabase | — |
| `redis` | `redis:7-alpine` + auth | só rede interna |
| `evolution` | imagem Evolution | 8080 interno |
| `proxy` | Caddy/Traefik | 80/443 |

### 7.2 Esboço (referência)

```yaml
# ESPECIFICAÇÃO — não versionado como implementação neste PR
services:
  api:
    build: ./apps/api
    env_file: ./secrets/api.env
    environment:
      NODE_ENV: production
      ASYNC_WORKERS_IN_API: "false"   # workers no serviço worker
      REDIS_HOST: redis
    depends_on: [redis]
    restart: unless-stopped
    networks: [internal]

  worker:
    build: ./apps/api
    command: ["node", "dist/worker.main"]
    env_file: ./secrets/api.env
    environment:
      NODE_ENV: production
      ASYNC_WORKERS_IN_API: "false"
      ASYNC_INBOUND_ENABLED: "true"
      ASYNC_FOLLOWUP_ENABLED: "true"
      ASYNC_RECONCILE_ENABLED: "true"
      REDIS_HOST: redis
    depends_on: [redis]
    restart: unless-stopped
    networks: [internal]

  web:
    build: ./apps/web
    environment:
      NODE_ENV: production
      API_INTERNAL_URL: http://api:3001
      NEXT_PUBLIC_API_BASE_URL: /backend
      NEXT_PUBLIC_APP_URL: https://app.seu-dominio.com
    depends_on: [api]
    restart: unless-stopped
    networks: [internal]

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD}"]
    volumes: [redis_data:/data]
    restart: unless-stopped
    networks: [internal]

  evolution:
    image: atendai/evolution-api:latest   # pin por digest em prod
    env_file: ./secrets/evolution.env
    volumes: [evolution_data:/evolution/instances]
    restart: unless-stopped
    networks: [internal]

  # postgres: usar Supabase (externo) — não subir no compose piloto

volumes:
  redis_data:
  evolution_data:

networks:
  internal:
```

### 7.3 Dockerfile API (estado atual)

- Multi-stage Node 22 alpine
- `CMD ["node", "dist/main.js"]` — **não** roda migrate no start
- **Deploy step obrigatório:** `npx prisma migrate deploy` antes/alongside do roll-out

### 7.4 Proxy

Rotas públicas sugeridas:

| Host | Upstream |
|------|----------|
| `app.dominio.com` | `web:3000` |
| `api.dominio.com` | `api:3001` |
| `evolution.dominio.com` | `evolution:8080` (restringir se possível) |

Web pode continuar com rewrite `/backend` → `api:3001` (evita CORS).

---

## 8. Estratégia de backup

### 8.1 Postgres (crítico)

| Camada | Frequência | Retenção sugerida piloto |
|--------|------------|--------------------------|
| Snapshots managed / Supabase PITR | contínuo | ≥7–14 dias |
| `pg_dump` lógico (schema+data) | diário | 14–30 cópias |
| Restore drill | mensal | evidência documentada |

Comandos de referência (ops):

```bash
pg_dump "$DIRECT_DATABASE_URL" -Fc -f autopilot-$(date +%F).dump
pg_restore -d "$DIRECT_DATABASE_URL_RESTORE" --clean --if-exists autopilot-YYYY-MM-DD.dump
```

Incluir: todas as tabelas tenant, `whatsapp_instances` (hashes de webhook), `users`/`memberships`, `refresh_tokens`/`sessions` (ou aceitar logout global pós-restore).

### 8.2 Redis

| Dado | Estratégia |
|------|------------|
| Bull jobs | AOF + restart; jobs podem reprocessar; reconcile cobre PENDING/stale |
| Auth cache | efêmero — OK perder |

Backup Redis: AOF volume diário opcional; prioridade é Postgres.

### 8.3 Evolution

- Volume de sessões WhatsApp: snapshot diário
- Perda do volume ⇒ novo QR / reconnect

### 8.4 Secrets

- Backup cifrado do secret store (JWT, Evolution key, OpenAI, DB)
- Rotação documentada; não commitar `.env`

### 8.5 RPO / RTO piloto (alvos)

| Métrica | Alvo piloto |
|---------|-------------|
| RPO | ≤ 24h (ideal PITR minutos) |
| RTO | ≤ 4h com runbook |

---

## 9. Estratégia de deploy

### 9.1 Artefatos

| App | Build | Artefato |
|-----|-------|----------|
| API | `npm ci && prisma generate && nest build` | image Docker / `dist/` |
| Worker | mesma image | cmd `worker.main` |
| Web | `npm ci && next build` | image ou Node `next start` |

CI atual (`.github/workflows/api-ci.yml`): lint/test/e2e/build da API — **não** faz deploy automático nem build do web.

### 9.2 Pipeline sugerido (piloto)

1. CI verde em `main`
2. Build images versionadas (git SHA)
3. `prisma migrate deploy` contra Postgres (URL direta)
4. Deploy API (rolling 1→1 ok no piloto)
5. Deploy worker
6. Deploy web
7. Smoke §10
8. Só então apontar DNS/clientes

### 9.3 Ordem de subida

```text
Postgres (Supabase) healthy
  → Redis healthy
  → migrate deploy
  → API
  → Worker (se separado)
  → Evolution
  → Web / Proxy
  → smoke WhatsApp + AI
```

### 9.4 Flags async no primeiro go-live

**Conservador (menos partes móveis):**

```bash
ASYNC_WORKERS_IN_API=true
ASYNC_INBOUND_ENABLED=false
ASYNC_FOLLOWUP_ENABLED=false
ASYNC_RECONCILE_ENABLED=false
ASYNC_AI_ENABLED=false
ASYNC_OUTBOUND_ENABLED=false
```

Webhook e send/suggest ficam **síncronos**. Ligar async depois do smoke estável.

### 9.5 Rollback

1. Reverter image API/web para SHA anterior
2. Migrations: só forward-fix; ter backup pré-migrate
3. Evolution/OpenAI independentes — não rollback de sessão WA sem necessidade

### 9.6 Criação do primeiro usuário

Não há signup público. Opções operacionais:

1. Script/admin one-off inserindo `User` + hash argon2 (ops)
2. Ambiente controlado com seed **não** prod + rotação imediata de senha
3. Futuro: endpoint de invite/accept (fora do estado atual)

---

## 10. Checklist go-live

### 10.1 Infra

- [ ] Postgres migrado (`prisma migrate deploy`) na URL direta
- [ ] Redis com senha + AOF; PING OK
- [ ] `JWT_ACCESS_SECRET` forte (≥32), único por ambiente
- [ ] `API_PUBLIC_URL` HTTPS correto
- [ ] `EVOLUTION_*` reais; `stubMode=false` em diagnostics
- [ ] `OPENAI_API_KEY` válida
- [ ] `SWAGGER_ENABLED=false` (ou basic auth forte)
- [ ] `ALLOW_PROD_SEED` ausente/false
- [ ] TLS em app/api/evolution
- [ ] Backup Postgres testado (restore drill)
- [ ] Proxy / rewrite web→API OK

### 10.2 Processos

- [ ] API `/health` `/health/live` `/health/ready` 200
- [ ] `/metrics` acessível só rede interna se possível
- [ ] Worker vivo **ou** `ASYNC_WORKERS_IN_API=true` consciente
- [ ] Logs estruturados (json) coletados

### 10.3 Smoke funcional

- [ ] Login → select-company → `/api/auth/me`
- [ ] Web: login → empresa → dashboard → leads
- [ ] Criar lead
- [ ] Criar conversa + mensagem
- [ ] WhatsApp connect → QR → CONNECTED
- [ ] Inbound real (1 msg)
- [ ] Outbound send
- [ ] AI suggest → approve → execute follow-up
- [ ] Dashboard KPIs coerentes
- [ ] Diagnostics OWNER full

### 10.4 Segurança

- [ ] RLS FORCE ativo (ver §15)
- [ ] Senhas default de seed **não** em uso
- [ ] Webhook secrets não são os do seed
- [ ] Exports só OWNER|ADMIN
- [ ] Rate limit ativo

### 10.5 Go / No-Go

| GO | NO-GO |
|----|-------|
| Smoke crítico verde | Evolution/Redis down |
| Backups OK | JWT fraco / swagger aberto |
| Runbooks lidos | Workers necessários parados sem plano |
| Senhas rotacionadas | IA obrigatória sem key |

Referência interna: `apps/api/docs/go-live-checklist.md` + runbooks em `apps/api/docs/runbooks/`.

---

## 11. Checklist — cadastrar a primeira empresa real

Pré-requisito: usuário `User` ACTIVE com senha (provisione offline).

1. [ ] `POST /api/auth/login` com o usuário
2. [ ] `POST /api/setup/company` body: `{ "name", "slug?", "timezone?", "locale?" }`  
       - Limite API: **máx. 1 company por user** (`SETUP_COMPANY_LIMIT`)
3. [ ] `POST /api/auth/select-company` com `{ "companySlug" }`
4. [ ] `GET /api/auth/me` → `company` + `membership.role=OWNER`
5. [ ] `GET /api/setup/status` → step `company` completo
6. [ ] `GET /api/settings` → ajustar `timezone` / `currency` se necessário (`PATCH`, OWNER|ADMIN)
7. [ ] (Opcional) `POST /api/memberships` para ADMIN/AGENT — status `INVITED`, **sem e-mail**; provisionar senha offline
8. [ ] Registrar no runbook: slug, companyId, owner email

**Não** usar `seed:pilot` / `seed:local` em base de cliente real.

---

## 12. Checklist — conectar o primeiro WhatsApp real

1. [ ] Evolution UP; `EVOLUTION_API_URL` + key na API
2. [ ] `API_PUBLIC_URL` HTTPS alcançável pela Evolution
3. [ ] JWT com `cid` (select-company)
4. [ ] Role OWNER ou ADMIN
5. [ ] `POST /api/whatsapp/connect` → `QR_PENDING` + `qrCode`
6. [ ] Escanear QR no WhatsApp Business/telefone do cliente
7. [ ] Poll `GET /api/whatsapp/status` até `CONNECTED` + `phoneNumber`
8. [ ] Confirmar webhook Evolution aponta para  
      `{API_PUBLIC_URL}/api/whatsapp/webhook/{instanceKey}`
9. [ ] Enviar 1 mensagem inbound de teste → aparece em conversations/messages
10. [ ] `POST /api/whatsapp/send` com `leadId` + `conversationId` + `body`
11. [ ] `GET /api/ops/diagnostics` → whatsapp ok, `stubMode: false`
12. [ ] Guardar runbook: instanceKey, phone, horário do connect

Se `ERROR`: ver `lastError`, circuit breaker, runbook WhatsApp.

---

## 13. Checklist — gerar a primeira resposta IA

1. [ ] `OPENAI_API_KEY` configurada; billing OK
2. [ ] Company selecionada; lead + conversa com histórico (inbound/outbound)
3. [ ] `POST /api/ai/conversations/{conversationId}/suggest` (body conforme DTO; pode ser `{}`)
4. [ ] Resposta sync: FollowUp `SUGGESTED` com `suggestedBody`  
      (se `ASYNC_AI_ENABLED=true`: `accepted` + `jobId` → worker processa)
5. [ ] `GET /api/follow-ups/{id}` → metadata source AI
6. [ ] `POST /api/follow-ups/{id}/approve` → `SCHEDULED`
7. [ ] WhatsApp `CONNECTED`
8. [ ] `POST /api/follow-ups/{id}/execute` → `EXECUTED` (ou `FAILED` com motivo)
9. [ ] Mensagem outbound correspondente na conversa
10. [ ] Diagnostics OpenAI ok; sem 503

**UI atual (Sprint 2):** follow-ups manuais/approve/execute existem; tela AI dedicada ainda não — validação via API/Swagger ou integração futura.

---

## 14. Checklist — validar workers

### 14.1 Topologia

| Modo | Como validar processo |
|------|------------------------|
| In-API | `ASYNC_WORKERS_IN_API=true`; um processo `node dist/main` |
| Dedicado | `ASYNC_WORKERS_IN_API=false` + `node dist/worker.main` |

### 14.2 Por fila

| Flag | Fila / scanner | Teste |
|------|----------------|-------|
| `ASYNC_INBOUND_ENABLED=true` | whatsapp-inbound | Webhook → `queued:true` → message persistida; ver waiting/completed |
| `ASYNC_FOLLOWUP_ENABLED=true` | followup-scheduler | Follow-up `SCHEDULED` due → auto execute |
| `ASYNC_RECONCILE_ENABLED=true` | reconcile | Stale PENDING/EXECUTING reconciliados |
| `ASYNC_AI_ENABLED=true` | ai-suggestions | suggest retorna job; FollowUp criado async |
| `ASYNC_OUTBOUND_ENABLED=true` | outbound-send | send enfileirado |

### 14.3 Checks Ops

```bash
curl -sS -H "Authorization: Bearer $TOKEN" "$API/api/ops/diagnostics"
curl -sS -H "Authorization: Bearer $TOKEN" "$API/api/ops/health"
curl -sS -H "Authorization: Bearer $TOKEN" "$API/api/ops/metrics"
```

Verificar: `queues.available`, depths, `dlqDepth`, `oldestDlqAgeMs`, failure rates.

### 14.4 Redis

- [ ] Jobs aparecem nas keys BullMQ
- [ ] Restart worker não perde AOF de forma catastrófica
- [ ] Sem flush durante teste

### 14.5 Falhas esperadas a forçar

- [ ] Evolution down → circuit / failed jobs / sem crash loop
- [ ] OpenAI 429/5xx → retry/backoff AI
- [ ] Worker kill -9 → jobs voltam a waiting; API HTTP continua se separada

---

## 15. Checklist — validar RLS

### 15.1 Estado esperado (migrations)

- [ ] Migration `20260804180000_rls_tenant_policies` aplicada
- [ ] Migration CRM `20260804190000` com RLS em `lead_notes` / `lead_activities`
- [ ] Funções `autopilot_rls_company_id()` e `autopilot_rls_bypass()` existem
- [ ] `FORCE ROW LEVEL SECURITY` nas tabelas tenant

### 15.2 Prova negativa (isolamento)

Com SQL (role da app **sem** bypass), em sessão limpa:

```sql
SELECT set_config('app.rls_bypass', 'off', true);
SELECT set_config('app.company_id', '<company_A_uuid>', true);
SELECT count(*) FROM leads;  -- só A

SELECT set_config('app.company_id', '<company_B_uuid>', true);
SELECT count(*) FROM leads;  -- só B; não vê A
```

- [ ] Company A não lê leads/messages/follow_ups de B
- [ ] INSERT com `company_id` ≠ GUC falha (WITH CHECK)
- [ ] Sem GUC e sem bypass: zero rows / fail em tabelas FORCE

### 15.3 Prova positiva (app)

- [ ] Login user company A → list leads só A
- [ ] Mesmo user sem membership em B → `select-company` B negado
- [ ] Webhook WhatsApp: resolve tenant por `instanceKey` (SELECT de `whatsapp_instances` permitido); writes subsequentes no contexto da company

### 15.4 Bypass

- [ ] Seed/migrate usam bypass só em janela controlada
- [ ] Requests HTTP **nunca** setam `app.rls_bypass=on`
- [ ] Scanners (due follow-ups / reconcile discovery) usam `runWithRlsBypassAsync` de propósito — auditar logs

### 15.5 Supabase

- [ ] Nenhuma policy `auth.uid()` conflitante nas tabelas Autopilot
- [ ] Service role do dashboard não é usada pelo app runtime
- [ ] Pooler não “come” `SET LOCAL` (transaction mode: SET LOCAL vale na transação Prisma — validar com teste §15.2 via API criando 2 companies)

### 15.6 Regressão contínua

- [ ] E2E/tenant tests no CI
- [ ] Após cada migration nova com tabela `company_id`: confirmar ENABLE+FORCE+policy

---

## Apêndice A — Endpoints de saúde úteis

| Path | Auth | Uso |
|------|------|-----|
| `/health` | público | liveness básica |
| `/health/live` | público | live |
| `/health/ready` | público | DB+Redis |
| `/metrics` | público* | Prometheus (*restringir em prod) |
| `/api/ops/diagnostics` | JWT+cid | full vs limited por role |
| `/api/ops/health` | JWT | filas/circuit |
| `/api/setup/status` | JWT | onboarding |

---

## Apêndice B — Documentos relacionados

| Doc | Path |
|-----|------|
| Go-live (API) | `apps/api/docs/go-live-checklist.md` |
| RLS review | `apps/api/docs/rls-review.md` |
| Runbooks | `apps/api/docs/runbooks/*` |
| Env exemplo API | `apps/api/.env.example` |
| Env exemplo Web | `apps/web/.env.example` |
| Compose lab | `apps/api/docker-compose.yml` |
| Arquitetura frontend | `docs/frontend-architecture.md` |

---

## Apêndice C — Decisão de arquitetura piloto (recomendada)

```text
Internet
  → Proxy TLS
      → Web (Next) /backend → API
      → API /api/whatsapp/webhook/*  (Evolution)
  → API ⇄ Supabase Postgres (RLS Autopilot)
  → API/Worker ⇄ Redis
  → API/Worker ⇄ Evolution
  → API/Worker ⇄ OpenAI
```

**Primeiro go-live:** async flags off (sync paths) → smoke WhatsApp+AI → ligar inbound/followup/reconcile gradualmente.

---

**Fim da auditoria operacional.** Nenhuma alteração de código/infra foi feita neste documento.
