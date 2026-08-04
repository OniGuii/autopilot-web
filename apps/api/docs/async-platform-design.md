# Fase 7 — Async Processing Platform Design

**Status:** Design para aprovação (**sem implementação**)  
**Fase:** 7 — Async Processing Platform  
**Origem:** `architecture-audit.md` (R4, R5, R13, Fase 7) + `channel-hardening-design.md` §13 + `channel-hardening-review.md`  
**Pré-requisitos:** WhatsApp 1–4, Follow-Ups, AI Assist, Ops 4.5, Fase 6A (Access), Fase 6B (Channel Hardening)  
**Restrições desta etapa de design:**
- **Sem código**
- **Sem migrations aplicadas**
- **Sem alteração de schema**
- Índices / colunas de job tracking, se necessários, ficam como **propostas** (7.2), não nesta entrega

---

## 1. Objetivo

Transformar Redis de “ping + lock + cache” em **backplane de filas** (BullMQ), desacoplando HTTP do I/O lento (Evolution/OpenAI) e habilitando automação confiável de FollowUps e reconcile — **reusando** os serviços síncronos já endurecidos na 6B.

```text
Hoje (pós-6B):
  HTTP → domínio sync (Evolution/OpenAI na request)
  Webhook sync + semáforo in-process
  FollowUp execute manual
  Reconcile HTTP manual (take=100)
  Redis: ready, AI lock, auth cache

Fase 7 (alvo):
  HTTP → validate → enqueue → 200/202 rápido
  Workers → mesmos serviços (Send / FollowUp / AI / Ops)
  DLQ + retries + métricas + graceful shutdown
  Redis: filas + locks + cache (backplane)
```

### 1.1 Dentro do escopo 7 (design)

| Tema | Entrega |
|---|---|
| BullMQ + Redis queues | Topologia, prefixes, connection |
| Workers planejados | send, followup-execute, ai-suggest, reconcile (+ inbound fundacional) |
| DLQ | Política e inspeção Ops |
| Retry / backoff | Por fila; alinhado à 6B (sem retry cego de sendText) |
| Idempotência | jobId + claims DB existentes |
| Observabilidade | Métricas/filas/alerts |
| Graceful shutdown | Drain / stalled jobs |
| Rollout gradual | Flags, sync fallback |
| Impacto WhatsApp / FollowUps / AI / Ops | Contratos |
| Decisões **A1–A10** | Aprovação |

### 1.2 Fora do escopo 7 (esta fase de design / implementação inicial)

- Código / migrations / schema nesta entrega de design  
- Troca de provedor WhatsApp  
- Auto-send de campanhas em massa  
- Multi-região / Redis Cluster avançado  
- Substituir EvolutionClient / CB / timeouts da 6B  
- RLS Postgres  

### 1.3 O que **não** reinventar (6A / 6B)

| Capacidade | Reusar |
|---|---|
| Evolution timeout / taxonomia / CB / cooldown | `EvolutionClient` |
| Send PENDING→SENT/FAILED + correlationId | `WhatsappSendService` |
| FollowUp EXECUTING claim + max 3 attempts | `FollowUpService` |
| AI Redis lock + OpenAI timeout | `AiService` / `OpenAiClient` |
| Webhook secret + tenant + `externalEventId` | `WhatsappService` |
| Reconcile take=100 / stale 5m | `OpsService` |
| Auth membership cache | 6A (independente) |

**Regra de ouro:** workers são **orquestradores finos** que chamam serviços existentes; lógica de domínio permanece nos módulos.

---

## 2. Estado atual (baseline)

| Path | Hoje | Dor |
|---|---|---|
| `POST /whatsapp/send` | Sync Evolution na request | Latência/hang mitigado (15s) mas ainda bloqueia worker HTTP |
| Webhook | Sync + inflight 50 | Burst Evolution → pressão API/DB (R4) |
| FollowUp execute/retry | Manual HTTP | Sem automação de `SCHEDULED` due (R5) |
| AI suggest | Sync + lock Redis | Request longa (até 25s OpenAI) |
| Ops reconcile | Manual dry-run/apply | Sem cron confiável |
| Redis | ioredis locks/cache/ping | Sem BullMQ (`package.json`) |

Comentário já no inbound: *“sync today; queue-ready tomorrow.”*

---

## 3. Arquitetura proposta

### 3.1 Visão

```text
                    ┌─────────────────────────────┐
   Clients / Evol.  │         Nest API            │
                    │  Controllers (thin)         │
                    │  validate auth/tenant       │
                    │  persist minimal / claim    │
                    └──────────┬──────────────────┘
                               │ BullMQ add(job)
                               ▼
                    ┌─────────────────────────────┐
                    │     Redis 7 (BullMQ)        │
                    │  queues + delayed + DLQ     │
                    └──────────┬──────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   Worker process(es)    (mesmo codebase Nest)
   - consome fila
   - chama *Service existente*
   - respeita CB/timeouts 6B
   - marca job completed/failed
```

### 3.2 Modelo de processo (decisão A2)

| Opção | Descrição | Trade-off |
|---|---|---|
| **A** | Workers **no mesmo processo** Nest da API | Simples; compete CPU com HTTP |
| **B** | Processo worker dedicado (`npm run worker`) | Isolamento; deploy 2 unit types |
| **C** | 1 processo por fila | Operacionalmente pesado cedo |

**Proposta:** **B** para produção controlada; **A** aceitável em staging/dev com flag.

### 3.3 Connection Redis

| Uso | Cliente |
|---|---|
| Locks / cache auth / AI lock | `RedisService` (ioredis atual) |
| BullMQ | Connection **separada** recomendada (BullMQ best practice: maxRetriesPerRequest=null) |

Prefixo de filas: `autopilot:bq:` (evitar colisão com `autopilot:auth:` / `autopilot:ai:`).

### 3.4 Camadas Nest (alvo implementação)

```text
modules/async/  (ou infra/queues/)
  queues.module.ts          — register BullMQ
  queue.names.ts            — constantes de filas
  producers/*.ts            — enqueue tipado
  workers/*.processor.ts    — consumers
  dlq.service.ts            — list/replay (Ops)
  async-metrics.service.ts
```

API modules (`whatsapp`, `follow-up`, `ai`, `ops`) **produzem** jobs; processors **importam** os services existentes.

---

## 4. Filas

| Fila BullMQ | Worker | Prioridade | Concurrency default (por worker process) |
|---|---|---|---|
| `whatsapp-inbound` | inbound processor (fundacional) | Alta | 10–20 |
| `whatsapp-send` | **whatsapp-send-worker** | Alta | 5 (respeita Evolution/CB) |
| `followup-execute` | **followup-execute-worker** | Média | 5 |
| `ai-suggest` | **ai-suggest-worker** | Baixa–média | 2–3 (custo OpenAI) |
| `reconcile` | **reconcile-worker** | Baixa | 1 |
| `*-dlq` (ou prefix failed) | inspeção Ops | — | — |

**Nota:** o usuário pediu 4 workers de produto; `whatsapp-inbound` é **pré-requisito de escala** (R4) e entra como fila fundacional — ver **A1**.

### 4.1 Relação com HTTP

| Endpoint | Comportamento Fase 7 (proposta) |
|---|---|
| `POST /whatsapp/webhook/:key` | Validate secret → persist `WebhookEvent` RECEIVED → enqueue inbound → **200** rápido |
| `POST /whatsapp/send` | Modo sync (default) **ou** enqueue (flag) — ver A4 |
| `POST /follow-ups/:id/execute` | Sync (compat) **ou** enqueue + 202 — ver A5 |
| Scheduler interno | Enfileira due `SCHEDULED` periodicamente |
| `POST /ai/.../suggest` | Sync default **ou** async job — ver A6 |
| Reconcile | Repeatable job Bull + endpoint Ops manual permanece |

---

## 5. Workers planejados

### 5.1 `whatsapp-send-worker`

**Responsabilidade:** executar envio outbound via `WhatsappSendService.send` (nunca Evolution direto).

| Item | Design |
|---|---|
| Trigger | API send (se async) ou FollowUp worker (indireto via service) |
| Payload | ver §6.1 |
| Pré-checagens | `assertChannelAvailable`; instance CONNECTED |
| Domínio | PENDING→SENT/FAILED já no service |
| Retry Bull | **Não** retentar se Message já FAILED por `UNCERTAIN_TIMEOUT` / 4xx; ver §8 |
| Idempotência | `jobId = send:{messageId}` **ou** criar PENDING no producer e job carrega `messageId` |

**Preferência (A4):** producer cria PENDING (ou valida input) e enfileira `{ messageId }` **somente se** Evolution ainda não foi chamado — evita double PENDING. Alternativa mais segura: job carrega DTO e service permanece dono do PENDING (jobId = `send:{correlationId}`).

### 5.2 `followup-execute-worker`

**Responsabilidade:** executar FollowUps `SCHEDULED` due (e opcionalmente retries enfileirados).

| Item | Design |
|---|---|
| Trigger | Repeatable “due scanner” + enqueue por `followUpId`; ou API execute→queue |
| Payload | `{ followUpId, companyId, correlationId?, trigger: 'schedule'|'api'|'retry' }` |
| Claim | Reusar `updateMany` → EXECUTING (já existe) |
| Canal | `assertConnected` + `assertChannelAvailable` **antes** do claim (já existe) |
| Retry Bull | Falhas transitórias de infra; **não** contornar `FOLLOWUP_MAX_ATTEMPTS` |
| Idempotência | `jobId = followup:exec:{followUpId}:{attempt}` |

Scanner (não é o 4º worker nomeado; faz parte do followup worker ou reconcile):

```text
a cada N segundos (Bull repeatable):
  SELECT follow_ups WHERE status=SCHEDULED AND scheduled_at <= now()
  LIMIT batch (ex. 50)
  enqueue followup-execute (jobId estável)
```

Índice desejável (7.2, **não** nesta design-only): `(company_id, status, scheduled_at)` — já citado em schema-audit.

### 5.3 `ai-suggest-worker`

**Responsabilidade:** gerar sugestão AI via `AiService.suggestForConversation` fora do request HTTP.

| Item | Design |
|---|---|
| Trigger | API suggest com `?async=1` / header / flag company |
| Payload | `{ companyId, conversationId, actorUserId, correlationId }` |
| Lock | Manter Redis gen-lock no service (worker também) |
| Resultado | FollowUp SUGGESTED (como hoje); cliente poll `GET follow-up` ou webhook interno futuro |
| Retry | 1–2 em TIMEOUT/5xx OpenAI; rate-limit → sem retry agressivo |
| Idempotência | `jobId = ai:suggest:{companyId}:{conversationId}:{window}` (ex. minuto) **ou** correlationId |

### 5.4 `reconcile-worker`

**Responsabilidade:** chamar `OpsService.reconcileMessages` / `reconcileFollowUps` com `apply=true` e `take` cap.

| Item | Design |
|---|---|
| Trigger | Bull **repeatable** (ex. a cada 5 min) + Ops “enqueue now” |
| Payload | `{ companyId?: null\|uuid, kind: 'messages'|'followups'|'both', apply: true }` |
| Escopo tenant | Por company (loop companies ACTIVE) **ou** job global com take — ver A7 |
| Limites | Sempre `OPS_RECONCILE_TAKE` (100) |
| Retry | Poucos; falha → DLQ + alerta Ops |
| Idempotência | Status guards já no updateMany; `jobId = reconcile:{kind}:{tick}` |

### 5.5 Fundacional: inbound webhook processor

Não está na lista de 4 nomes do pedido, mas é o maior ganho de escala (R4):

```text
HTTP: secret OK → WebhookEvent RECEIVED → enqueue whatsapp-inbound
Worker: processConnection | processDelivery | processInboundMessage
```

Idempotência: `jobId = webhook:{webhookEventId}`; domínio já dedupe por `externalEventId` / `externalMessageId`.

---

## 6. Payloads

### 6.1 `whatsapp-send`

```json
{
  "v": 1,
  "companyId": "uuid",
  "actorUserId": "uuid",
  "correlationId": "uuid",
  "leadId": "uuid",
  "conversationId": "uuid",
  "body": "text",
  "metadata": {
    "source": "whatsapp_send|followup",
    "followUpId": "uuid?",
    "attempt": 1
  }
}
```

Variante pós-PENDING: `{ "v":1, "messageId":"uuid", "companyId":"uuid", "correlationId":"uuid" }`.

### 6.2 `followup-execute`

```json
{
  "v": 1,
  "companyId": "uuid",
  "followUpId": "uuid",
  "correlationId": "uuid",
  "trigger": "schedule|api|retry",
  "requestedByUserId": "uuid?"
}
```

### 6.3 `ai-suggest`

```json
{
  "v": 1,
  "companyId": "uuid",
  "conversationId": "uuid",
  "actorUserId": "uuid",
  "correlationId": "uuid"
}
```

### 6.4 `reconcile`

```json
{
  "v": 1,
  "kind": "messages|followups|both",
  "companyId": "uuid|null",
  "apply": true,
  "take": 100
}
```

### 6.5 `whatsapp-inbound` (fundacional)

```json
{
  "v": 1,
  "companyId": "uuid",
  "webhookEventId": "uuid",
  "instanceId": "uuid",
  "eventType": "string"
}
```

**Contrato:** payloads versionados (`v`); producers rejeitam/ignoram `v` desconhecido nos workers (fail → DLQ).

---

## 7. Estados

### 7.1 Job BullMQ (infra)

| Estado | Significado |
|---|---|
| `waiting` | Na fila |
| `active` | Worker processando |
| `completed` | Sucesso |
| `failed` | Esgotou attempts → candidata a DLQ |
| `delayed` | Backoff / schedule |
| `paused` | Fila pausada (ops) |

### 7.2 Domínio (inalterado semanticamente)

| Entidade | Estados relevantes |
|---|---|
| Message | PENDING / SENT / DELIVERED / READ / FAILED (+ heal FAILED→SENT) |
| FollowUp | SCHEDULED → EXECUTING → EXECUTED \| FAILED |
| WebhookEvent | RECEIVED → PROCESSED \| IGNORED \| DUPLICATE \| FAILED |
| AI | Gera FollowUp SUGGESTED (sem estado de job no schema 7.1) |

### 7.3 Mapeamento falha job ↔ domínio

| Situação | Domínio | Job |
|---|---|---|
| Evolution TIMEOUT após PENDING | Message FAILED `UNCERTAIN_TIMEOUT` | **completed** (domínio já finalizou) ou failed sem retry |
| CB OPEN no início | Sem PENDING / sem EXECUTING | delayed retry curto **ou** failed com reason CHANNEL_UNAVAILABLE |
| Claim FollowUp perde corrida | Sem mudança | completed (noop) |
| Webhook domínio ok | PROCESSED | completed |
| Bug/crash mid-job | PENDING/EXECUTING órfão | stalled → retry; reconcile limpa stale |

**Princípio:** se o domínio já marcou FAILED/EXECUTED de forma definitiva, o job **não** deve retentar às cegas.

---

## 8. Estratégia de retry (BullMQ)

### 8.1 Defaults por fila

| Fila | attempts | backoff | Notas |
|---|---|---|---|
| `whatsapp-inbound` | 5 | exp 2s, jitter | Domínio idempotente |
| `whatsapp-send` | **1–2** | — | Alinhado CH2: **não** espelhar retry Evolution sendText; preferir 1 attempt se PENDING já criado |
| `followup-execute` | 3 | exp 5s | Só se claim não consumiu attempt de negócio; senão 1 |
| `ai-suggest` | 3 | exp 3s | Respeitar rate-limit → delay maior |
| `reconcile` | 2 | fixo 30s | take cap |

### 8.2 Classificação (reusar 6B)

| Erro | Retry Bull? |
|---|---|
| `CIRCUIT_OPEN` / `CONNECT_COOLDOWN` | Delayed (aguardar OPEN→HALF_OPEN) |
| `TIMEOUT` send (UNCERTAIN) | **Não** (risco duplicata) |
| `RATE_LIMIT` | Delayed Respect Retry-After |
| `PROVIDER_4XX` | Não |
| Lock AI 409 | Delayed curto ou fail |
| DB transient | Sim |

### 8.3 Backoff

```text
delay = min(maxDelay, base * 2^(attempt-1)) + jitter
```

Proposta global: `base=2000ms`, `maxDelay=60s`, jitter 20%.  
Filas AI/reconcile podem ter bases maiores.

---

## 9. Dead Letter Queue (DLQ)

### 9.1 Modelo

Após `attempts` esgotadas → job move para fila `dlq:{originalQueue}` (ou BullMQ `failed` set + Ops UI).

Payload DLQ inclui:

```json
{
  "originalQueue": "whatsapp-send",
  "originalJobId": "...",
  "failedReason": "...",
  "errorClass": "TIMEOUT|...",
  "payload": {},
  "correlationId": "uuid",
  "failedAt": "ISO-8601",
  "attemptsMade": 3
}
```

### 9.2 Operação

| Ação Ops | Endpoint (futuro) |
|---|---|
| Listar DLQ | `GET /ops/queues/dlq?queue=` |
| Replay | `POST /ops/queues/dlq/:id/replay` (re-enqueue original) |
| Discard | `POST /ops/queues/dlq/:id/discard` + audit |

**Sem auto-replay** na 7.1. Alertas: `QUEUE_DLQ_DEPTH`, `QUEUE_AGE_P95`.

---

## 10. Idempotência

| Camada | Mecanismo |
|---|---|
| Bull `jobId` | Estável por entidade/ação (ver §5) |
| Webhook | `externalEventId` unique parcial |
| Message | `externalMessageId`; PENDING único por tentativa |
| FollowUp | `updateMany` claim EXECUTING |
| AI | Redis lock + rate limits DB |
| Reconcile | Status predicates + take |
| Correlation | CH13 `correlationId` em metadata/audit — rastreio cross-job |

**Proibição:** dois jobs ativos com mesmo `jobId`. BullMQ dedupe natural.

---

## 11. Observabilidade

### 11.1 Métricas (além das 6B)

| Métrica | Tipo |
|---|---|
| `queue_waiting_count{queue}` | gauge |
| `queue_active_count{queue}` | gauge |
| `queue_failed_count{queue}` | counter |
| `queue_dlq_depth{queue}` | gauge |
| `job_duration_ms{queue}` | histogram |
| `job_retries_total{queue}` | counter |
| `worker_stalled_total` | counter |

Expor em `GET /ops/metrics` (JSON piloto) + logs estruturados (`queue`, `jobId`, `correlationId`, `durationMs`).

### 11.2 Alertas Ops

- `QUEUE_BACKLOG_HIGH` (waiting > limiar)
- `QUEUE_DLQ_DEPTH`
- `WORKER_STALLED`
- Manter `EVOLUTION_CIRCUIT_OPEN`, `WEBHOOK_SLOW` (6B)

### 11.3 Health

| Endpoint | Fase 7 |
|---|---|
| `/ready` | Postgres + Redis (+ opcional: workers heartbeat key) |
| `/ops/health` | + `queues: { name, waiting, failed }` |

**Não** marcar pod unready só porque Evolution CB OPEN (já decidido CH10).

### 11.4 Tracing

Propagar `correlationId` do producer → job data → service → audit (já parcial na 6B).

---

## 12. Graceful shutdown

```text
SIGTERM:
  1. parar de aceitar novos jobs (worker.close)
  2. aguardar active jobs até timeout (ex. 30s ≥ send timeout 15s)
  3. jobs não terminados → stalled/recover pelo BullMQ lock renewal
  4. fechar conexões Redis/Prisma
  5. exit
```

| Config | Proposta |
|---|---|
| `lockDuration` | ≥ maior timeout de job (send 15s + margem → **30–45s**) |
| `stalledInterval` | 30s |
| API Nest | `enableShutdownHooks()` já avaliar; workers espelham |

Deploy: rolling update sobe workers novos antes de drenar antigos (K8s `preStop` sleep).

---

## 13. Impacto por módulo

### 13.1 WhatsApp

| Área | Impacto |
|---|---|
| Webhook | Maior: ack rápido; processamento no worker inbound |
| Send | Opcional async; Evolution/CB inalterados |
| Delivery/echo heal | Roda no worker inbound (mesmo service) |
| Semáforo HTTP | Substitui gradualmente por profundidade de fila |

**Risco:** duplicar PENDING se producer+worker ambos criarem Message — mitigar com ownership único (A4).

### 13.2 FollowUps

| Área | Impacto |
|---|---|
| Produto | `SCHEDULED` due passa a disparar sem clique (R5) |
| Execute API | Pode permanecer sync para UX imediata |
| Attempts | Continua regra de negócio (max 3), independente de retries Bull |
| EXECUTING stale | Reconcile worker reforça rede de segurança |

### 13.3 AI

| Área | Impacto |
|---|---|
| Suggest sync | Default mantém UX simples |
| Async mode | 202 + poll FollowUp SUGGESTED |
| Lock Redis | Continua válido dentro do worker |
| Custo | Concurrency baixa na fila `ai-suggest` |

### 13.4 Ops

| Área | Impacto |
|---|---|
| Reconcile | Automatizado (repeatable) + manual |
| Nova superfície | Filas / DLQ / replay |
| Metrics | Extensão natural do JSON Ops |
| Runbooks | DLQ + backlog + stalled |

---

## 14. Rollout gradual

```text
7.0  Design aprovado (A1–A10)          ← esta entrega
7.1  Infra BullMQ + worker process
     + fila whatsapp-inbound (flag off → sync)
7.2  followup-execute scanner + worker (flag)
7.3  reconcile repeatable
7.4  whatsapp-send async opcional
7.5  ai-suggest async opcional
7.6  Ops DLQ UI/API + review doc
```

### 14.1 Feature flags

| Flag | Default staging | Default prod piloto |
|---|---|---|
| `ASYNC_INBOUND_ENABLED` | true | false → true |
| `ASYNC_FOLLOWUP_SCHEDULER_ENABLED` | true | false → true |
| `ASYNC_SEND_ENABLED` | false | false |
| `ASYNC_AI_ENABLED` | false | false |
| `ASYNC_RECONCILE_ENABLED` | true | true (baixo risco) |

### 14.2 Critérios para avançar flag

- Waiting p95 estável  
- DLQ ~0 para inbound  
- Sem aumento de PENDING stale  
- CB Evolution não oscila por retry storm  

### 14.3 Rollback

Flags off → paths sync 6B permanecem. Filas drenam ou pausam. **Não** remover código sync na 7.1.

---

## 15. Decisões arquiteturais A1–A10

| ID | Pergunta | Proposta |
|---|---|---|
| **A1** | Incluir fila `whatsapp-inbound` na 7.1 além dos 4 workers? | **Sim** — fundacional (R4); os 4 workers de produto vêm em paralelo/logo após |
| **A2** | Workers no mesmo processo da API ou dedicados? | **Dedicados em prod** (`npm run worker`); same-process em dev |
| **A3** | Biblioteca | **BullMQ** + Redis existente (não Agenda/SQS nesta fase) |
| **A4** | `POST /whatsapp/send` vira async por default? | **Não** — sync default; async só com flag/empresa |
| **A5** | FollowUp execute API | **Sync default**; scheduler async para due `SCHEDULED` |
| **A6** | AI suggest | **Sync default**; async opt-in |
| **A7** | Reconcile scope | Jobs **por company** (ACTIVE) com take=100; evita scan global sem limite |
| **A8** | Retry Bull em `whatsapp-send` após TIMEOUT? | **Não** (anti-duplicata; alinhado CH2/CH3) |
| **A9** | Schema/migrations na 7.1? | **Não** — job state no Redis/Bull; índices FollowUp due = **7.2 opcional** |
| **A10** | DLQ replay | **Manual via Ops** na 7.x; sem auto-replay |

---

## 16. Pacotes de implementação (após aprovação) — P7-1…

| ID | Pacote | Deps |
|---|---|---|
| P7-1 | Deps BullMQ + `QueuesModule` + connection Redis dedicada | — |
| P7-2 | Worker bootstrap + graceful shutdown | P7-1 |
| P7-3 | Fila inbound + flag + processor | P7-2 |
| P7-4 | followup-execute worker + due scanner | P7-2 |
| P7-5 | reconcile repeatable worker | P7-2 |
| P7-6 | whatsapp-send enqueue path (flag) | P7-2 |
| P7-7 | ai-suggest enqueue path (flag) | P7-2 |
| P7-8 | Ops metrics/DLQ/list/replay | P7-3…7 |
| P7-9 | Testes (unit processors + e2e flags) | P7-8 |
| P7-10 | `async-platform-review.md` | P7-9 |

---

## 17. Riscos

| ID | Risco | Severidade | Mitigação |
|---|---|---|---|
| AR1 | Double send / double PENDING | Alta | A4/A8; jobId; um único owner do PENDING |
| AR2 | Retry storm com CB OPEN | Alta | Delayed jobs; respeitar CB; A8 |
| AR3 | Redis SPOF | Alta | Ready check; monitoring; Redis HA fora desta fase |
| AR4 | Stalled jobs → EXECUTING/PENDING órfãos | Média | lockDuration; reconcile worker |
| AR5 | Multi-réplica + CB in-memory (6B) | Média | Aceito; Redis CB futuro |
| AR6 | Escopo creep (tudo async de uma vez) | Alta | Flags A4–A6; rollout §14 |
| AR7 | Payload drift sem versionamento | Média | campo `v` |
| AR8 | Custo OpenAI com concurrency alta | Média | concurrency baixa AI |
| AR9 | Ops sem ferramenta DLQ | Média | P7-8 obrigatório antes de prod ampla |

---

## 18. Classificação de esforço (técnico — sem calendário)

| Dimensão | Classificação | Detalhe |
|---|---|---|
| **Superfície de código** | **Média–Alta** | Novo módulo filas + 5 processors + worker entrypoint; pouco rewrite de domínio |
| **Invasividade nos módulos** | **Baixa–Média** | Producers opcionais atrás de flags; services 6B reusados |
| **Ops / deploy** | **Média** | Segundo process type; envs Bull; runbooks DLQ |
| **Schema/DB** | **Baixa (7.1)** | Sem migration obrigatória; índice due = opcional 7.2 |
| **Testes** | **Média** | Precisa Redis real/fake; testes de idempotência e flags |
| **Risco de regressão produto** | **Médio** | Mitigado por sync default + flags |
| **Esforço relativo vs 6B** | **~2× 6B** em integração/ops; domínio mais simples que 6B |

**Pacote mínimo de valor (MVP Fase 7):** P7-1…P7-5 + P7-8 parcial (inbound + followup scheduler + reconcile). Send/AI async podem esperar.

---

## 19. ROI técnico

| Benefício | Valor |
|---|---|
| Remove sync webhook do caminho crítico | Desbloqueia escala ~100→~1k (audit) |
| FollowUp due automático | Fecha buraco de produto (R5) |
| Reconcile contínuo | Menos PENDING/EXECUTING órfãos |
| Isolamento de falhas Evolution/OpenAI | API HTTP permanece responsiva |
| Reuso 6B | ROI alto: pouco retrabalho de canal |
| DLQ + métricas | Operabilidade sem “tail -f” |

| Custo | Valor |
|---|---|
| Complexidade operacional (workers) | Médio |
| Redis torna-se crítico além de ready/lock | Já era; agora mais |
| Dois modos sync/async durante rollout | Dívida temporária aceitável |

**Veredito ROI:** **Alto** para inbound + followup scheduler + reconcile; **Médio** para send/AI async imediato (ganho UX menor se timeouts 6B já limitam hang).

---

## 20. Critérios de aceite do design (esta entrega)

- [x] Documento cobre BullMQ, filas, workers, DLQ, retry, backoff, idempotência, observabilidade, graceful shutdown  
- [x] Quatro workers nomeados planejados + inbound fundacional  
- [x] Payloads / estados / retries / métricas / rollout  
- [x] Impacto WhatsApp, FollowUps, AI, Ops  
- [x] Decisões **A1–A10** explícitas  
- [x] Esforço, riscos, ROI classificados  
- [x] Sem código / schema / migrations nesta entrega  

---

## 21. Próximo passo

**Aguardando aprovação A1–A10.**  
Somente após aprovação → implementar **7.1** começando por P7-1 (BullMQ infra) + P7-3 (inbound), **sem** Fase de filas “meio-pronta” em produção sem flags.

**Não implementar código nesta entrega.**  
**Não criar migrations.**  
**Não alterar schema.**
