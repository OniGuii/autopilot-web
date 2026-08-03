# P0 Hardening Sprint — Review

**Status:** Implementado  
**Escopo:** Itens críticos do `release-readiness.md` (C1–C5 relevantes ao P0 pedido)  
**Branch:** `cursor/p0-hardening-dd93`  
**Restrições:** sem novas features, sem mudança de domínio, sem frontend, sem nova fase

---

## 1. Objetivo

Eliminar os riscos críticos de misconfig e operação que bloqueavam produção/piloto seguro:

1. JWT secret obrigatório  
2. Evolution stub proibido fora de dev/test  
3. Health checks reais (Postgres + Redis)  
4. AI lock distribuído via Redis  
5. GitHub Actions CI  

---

## 2. Entregas

| # | Item | Como | Status |
|---|---|---|---|
| 1 | JWT secret obrigatório | `env.validation`: required ≥32 chars fora de `test`; rejeita fallback inseguro; `configuration` sem default frágil | ✅ |
| 2 | Evolution stub fail-closed | `EvolutionClient.assertStubAllowed()` → 503 em `production` (e qualquer env ≠ development/test) sem URL | ✅ |
| 3 | Health ready real | `GET /health/ready` checa `SELECT 1` (Postgres) + Redis `PING`; 503 se qualquer um down | ✅ |
| 4 | AI lock Redis | `RedisService.tryAcquireLock` / `releaseLock` (SET NX PX + Lua unlock); `AiService` sem `Set` in-memory | ✅ |
| 5 | GitHub Actions CI | `.github/workflows/api-ci.yml` — test + build (gate); lint informativo (dívida ESLint pré-existente) | ✅ |

---

## 3. Arquivos principais

| Path | Mudança |
|---|---|
| `src/config/env.validation.ts` | JWT obrigatório / default só em test |
| `src/config/configuration.ts` | Remove fallback inseguro de JWT |
| `src/shared/redis/redis.service.ts` | Cliente ioredis (lazy), ping + lock |
| `src/shared/redis/redis.module.ts` | Módulo global |
| `src/modules/health/health.service.ts` | Ready com Postgres + Redis |
| `src/modules/whatsapp/evolution.client.ts` | Stub só em development/test |
| `src/modules/ai/ai.service.ts` | Lock distribuído |
| `src/modules/ai/ai.constants.ts` | TTL/prefixo do lock |
| `.github/workflows/api-ci.yml` | Pipeline CI |
| `.env.example` | Nota sobre JWT obrigatório |

Dependência nova: `ioredis`.

---

## 4. Comportamento por ambiente

| Env | JWT secret | Evolution stub | `/health/ready` | AI lock |
|---|---|---|---|---|
| `test` | default CI seguro se omitido | permitido | Postgres+Redis reais (ou 503) | Redis |
| `development` | **obrigatório** (≥32, ≠ fallback antigo) | permitido se URL vazia | Postgres+Redis | Redis |
| `production` | **obrigatório** | **proibido** sem URL → 503 | Postgres+Redis | Redis |

---

## 5. Critérios de aceite (P0)

- [x] Boot falha (validação Joi) sem `JWT_ACCESS_SECRET` fora de test  
- [x] Fallback `dev-only-access-secret-change-me` rejeitado  
- [x] Production sem `EVOLUTION_API_URL` não envia/conecta em stub  
- [x] `/health/ready` reflete Postgres + Redis  
- [x] Duas gerações AI paralelas na mesma conversation → 409 via Redis  
- [x] CI roda test + build (gate) e lint informativo  
- [x] Sem migration / schema / feature de domínio  

---

## 6. Testes adicionados/atualizados

- `config/env.validation.spec.ts`  
- `health/health.service.spec.ts` + controller spec atualizado  
- `whatsapp/evolution.client.spec.ts`  
- `ai/ai.service.spec.ts` (mock Redis lock)  

---

## 7. Fora deste sprint (ainda no backlog readiness)

Não resolvidos de propósito (não estavam no escopo P0 pedido):

- Swagger default off em production  
- Rate limit global login/webhook  
- Revalidação de membership a cada request  
- Count storms Ops/Dashboard  
- Filas / worker FollowUp  
- Testes unitários Auth/Leads/Conversations  
- Ativação das Prisma tenant/soft-delete extensions  

---

## 8. Notas operacionais

1. Dev local precisa de `JWT_ACCESS_SECRET` no `.env` (já tipicamente presente).  
2. Ready probe de orquestração deve apontar para `/health/ready` (não `/health`).  
3. Liveness continua em `/health/live` (processo).  
4. Redis é **obrigatório** para ready e para AI suggest (lock); downtime Redis → ready 503 e AI 503/lock fail.  
5. CI atual não sobe Postgres/Redis porque os unit tests mockam dependências; e2e DB fica para sprint futuro.  
6. `npm run lint` no repo já falhava com centenas de erros pré-existentes; o job de lint no CI é `continue-on-error` até limpeza dedicada (não bloqueia merge de hardening).

---

## 9. Conclusão

P0 Hardening Sprint **completo** para os 5 itens solicitados.  
Sistema mais seguro para piloto: fail-closed de secrets/Evolution, readiness honesto, lock AI multi-instância e rede mínima de CI.

**Aguardar aprovação** antes de qualquer nova fase ou sprint de produto.
