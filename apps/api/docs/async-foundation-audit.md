# Fase 7.1 — Async Foundation Audit

**Escopo:** auditoria da implementação em `cursor/async-foundation-impl-dd93` (PR #27, commits `1e28f7e` + `a360994`)  
**Modo:** somente leitura — **nenhuma alteração de código nesta entrega**  
**Referências:** `async-platform-design.md` (A1–A11), `async-foundation-review.md`

---

## 1. Resumo executivo

A 7.1 entrega a fundação BullMQ correta em estrutura (Queue/Worker modules, fila inbound, DLQ, flags, métricas Ops básicas, `correlationId` no job). O caminho default (`ASYNC_INBOUND_ENABLED=false`) permanece sync e rollback-safe.

Há lacunas de robustez operacional que **não bloqueiam começar o código da 7.2**, mas **bloqueiam ligar a flag async em produção** sem ajustes. Nenhum P0 de perda silenciosa garantida foi encontrado com a flag off; com a flag on, o principal risco é **processamento duplo sob falha ambígua de enqueue** e **race por stall sem claim atômico**.

### Veredito

**Ajustes necessários** antes de considerar a foundation “pronta para produção com flag ON”.

**Para iniciar 7.2 (workers send/followup/ai no código, ainda atrás de flags):** aceitável **somente se** os P1 abaixo forem tratados em paralelo / antes do enablement — a 7.2 reutilizará os mesmos padrões e herdará estes gaps.

---

## 2. Mapa da implementação auditada

| Artefato | Papel |
|---|---|
| `modules/async/queue.module.ts` | Bull root (`prefix autopilot:bq`), filas, producer, DLQ, metrics |
| `modules/async/worker.module.ts` | `WhatsappInboundProcessor` (+ `WhatsappModule`) |
| `modules/async/producers/whatsapp-inbound.producer.ts` | `jobId=webhook:{webhookEventId}`, attempts/backoff |
| `modules/async/workers/whatsapp-inbound.processor.ts` | process + failed→DLQ |
| `modules/async/dlq.service.ts` | fila `dlq-whatsapp-inbound`, `removeOn*=false` |
| `modules/async/async-metrics.service.ts` | counts → Ops |
| `worker.main.ts` | processo dedicado + `enableShutdownHooks()` |
| `whatsapp.service.ts` | enqueue sob flag; `processQueuedWebhook`; fallback sync |

---

## 3. Validação por critério

### 3.1 Idempotência

| Camada | Estado | Evidência |
|---|---|---|
| Bull `jobId` estável | **OK** | `webhook:{webhookEventId}` no producer |
| Webhook DB (`externalEventId`) | **OK parcial** | unique/P2002 → `DUPLICATE`; se `externalEventId=null`, cria evento novo sempre |
| Worker skip terminal | **OK** | `PROCESSED` / `IGNORED` / `DUPLICATE` → noop |
| Retry após `FAILED` | **OK intencional** | `FAILED` **não** é skip — permite retry de domínio |
| Domínio message | **OK** | `externalMessageId` dedupe no inbound |
| Claim atômico do evento | **FALTA** | `finalizeWebhookEvent` faz `update` sem predicado `status=RECEIVED` |
| Payload `v` | **FALTA** | design pede rejeitar `v` desconhecido → DLQ; worker não valida `v` |

**Nota crítica — fallback sync:** qualquer erro em `enqueue` cai em `dispatchWebhookEvent` sync. Se o job **já tiver sido gravado** no Redis e o client falhar no ack (timeout/rede), ou se o erro for “jobId already exists”, o HTTP processa sync **enquanto** o worker também consome → **dupla execução** até o domínio idempotente absorver.

**Score:** Parcial — boa base; falha no fail-open + ausência de claim.

---

### 3.2 Retries

| Item | Estado | Evidência |
|---|---|---|
| Attempts default 5 | **OK** | producer + config `ASYNC_INBOUND_ATTEMPTS` |
| Backoff exponential base 2s | **OK** | `backoff: { type: 'exponential', delay }` |
| Jitter | **FALTA** | design §8.3 pede jitter; não configurado |
| Retry só em erro transitório | **Parcial** | qualquer throw do domínio retenta; não há classificação 6B no worker inbound |
| Log de retry | **OK** | `onFailed` com `attemptsMade/attempts` |
| DLQ só na tentativa final | **OK** | `attemptsMade < attempts` → return; senão DLQ |

**Score:** Adequado para 7.1 inbound; classificação de erro fica para endurecimento / 7.2 send.

---

### 3.3 DLQ

| Item | Estado | Evidência |
|---|---|---|
| Fila dedicada | **OK** | `dlq-whatsapp-inbound` (nome sem `:`) |
| Payload versionado + correlation | **OK** | `DlqJobPayload` |
| jobId DLQ estável | **OK** | `dlq:{originalJobId}` |
| Persistência | **OK / risco** | `removeOnComplete/Fail: false` — não perde DLQ, **cresce sem bound** |
| Falha ao mover DLQ | **Parcial** | log error; job permanece em `failed` da fila principal (`removeOnFail: 5000`) |
| Replay Ops | **N/A 7.1** | design: futuro — aceitável |
| Alerta profundidade | **OK** | `QUEUE_DLQ_DEPTH` |

**Score:** Básica funcional; operacionalmente incompleta (sem teto/TTL/replay).

---

### 3.4 Correlation IDs (A11)

| Item | Estado | Evidência |
|---|---|---|
| Geração no HTTP | **OK** | `newCorrelationId()` antes do enqueue |
| Payload do job | **OK** | campo obrigatório no type |
| Response HTTP | **OK** | `correlationId` / `jobId` quando queued |
| Logs producer/worker | **OK** | string interpolada |
| Persistência em `WebhookEvent` | **FALTA** | sem migration (explícito na review) — correlação só em job/logs/response |
| Audit inbound com correlation | **Parcial** | outbound/follow-up já usam; path inbound do worker não amarra correlation no audit de forma consistente |

**Score:** Suficiente para rastreio operacional básico da 7.1; incompleto para forensic end-to-end só via DB.

---

### 3.5 Graceful shutdown

| Item | Estado | Evidência |
|---|---|---|
| API `enableShutdownHooks()` | **OK** | `main.ts` |
| Worker `enableShutdownHooks()` | **OK** | `worker.main.ts` |
| Drain explícito (parar fetch + await active) | **FALTA** | sem `beforeApplicationShutdown` / timeout de drain documentado no código |
| `lockDuration` 45s | **OK** | alinhado ao design (stall recovery) |
| `stalledInterval` custom | **Default BullMQ** | não configurado |
| Deploy notes (preStop) | **FALTA** | só no design |

**Risco:** SIGTERM durante job longo → stall → re-entrega (at-least-once). Aceitável se domínio idempotente; hoje claim do `WebhookEvent` não é atômico.

**Score:** Mínimo Nest; abaixo do §12 do design.

---

### 3.6 Memory leaks

| Item | Estado | Notas |
|---|---|---|
| Retenção completed inbound | **OK** | `removeOnComplete: 1000` |
| Retenção failed inbound | **OK** | `removeOnFail: 5000` |
| DLQ retention | **Risco crescimento** | sem remoção / TTL / max length |
| Listeners worker | **OK** | handlers Nest/Bull padrão |
| Conexões Redis duplicadas | **Atenção** | Bull connection ≠ `RedisService` — dois clientes; não é leak, mas dobra superfície |
| Payload truncado no DB | **OK** | 50k no `WebhookEvent` (pré-existente) |

**Score:** Fila principal bounded; DLQ é o vetor de crescimento de memória/Redis.

---

### 3.7 BullMQ concurrency

| Item | Estado | Evidência |
|---|---|---|
| Default 10 | **OK** | decorator `@Processor(..., { concurrency: 10 })` |
| Env `ASYNC_INBOUND_CONCURRENCY` | **NÃO EFETIVO** | validado em `env.validation` / `configuration.async.inboundConcurrency`, **não lido** pelo processor |
| Multi-instance | **OK/risco** | N processos × concurrency = paralelismo global sem teto distribuído |

**Score:** Funciona com default; config documentada engana operadores.

---

### 3.8 Redis reconnection

| Item | Estado | Evidência |
|---|---|---|
| `maxRetriesPerRequest: null` | **OK** | obrigatório para BullMQ workers |
| host/port/password | **OK** | via ConfigService |
| `retryStrategy` / backoff explícito | **Default ioredis** | não customizado no `QueueModule` |
| Handlers `error`/`close` na connection Bull | **FALTA** | sem log estruturado dedicado |
| Ready/health vs filas | **Parcial** | `/ready` usa `RedisService`; Bull tem cliente separado — Redis “up” no ping não prova o client Bull saudável |
| Fail-open enqueue | **Design consciente** | evita `RECEIVED` preso; introduz race (ver 3.1) |

**Score:** Config mínima correta; observabilidade de reconnect fraca.

---

### 3.9 Job duplication

| Cenário | Risco | Mitigação atual |
|---|---|---|
| Reentrega Bull (retry/stall) | Esperado (at-least-once) | skip terminal + dedupe `externalMessageId` |
| Mesmo `jobId` re-add | Baixo | Bull rejeita enquanto job existe; após `removeOnComplete`, novo add com mesmo id seria possível — só via replay manual (ainda não existe) |
| Enqueue ok + fallback sync por erro ambíguo | **Alto** | domínio parcialmente idempotente |
| Dois workers no mesmo evento (stall + sem claim) | **Médio** | race em connection/delivery |
| `externalEventId` null | **Médio** | múltiplos `WebhookEvent` + jobs para o “mesmo” evento lógico |

**Score:** Dedup de jobId ok; duplicação de *processamento* ainda possível.

---

### 3.10 Observabilidade

| Item design 7.x | Estado 7.1 |
|---|---|
| `queues.whatsappInbound.*` counts | **OK** |
| `dlqWhatsappInbound` | **OK** |
| Alertas `QUEUE_BACKLOG_HIGH` / `QUEUE_DLQ_DEPTH` | **OK** |
| `job_duration_ms` | **FALTA** |
| `job_retries_total` | **FALTA** |
| `worker_stalled_total` | **FALTA** |
| `QUEUE_AGE_P95` | **FALTA** |
| Logs com correlation | **OK (texto)** |
| Metrics fail → zeros | **Risco** | `AsyncMetricsService.snapshot` engole erro e devolve 0 — **falso verde** em alertas |
| Heartbeat worker em `/ready` | **FALTA** (opcional no design) |

**Score:** Piloto útil; insuficiente para operar sob carga sem cegueira parcial.

---

## 4. Avaliação de riscos

### 4.1 Processamento duplo

| Severidade | Descrição |
|---|---|
| **P1** | Fallback sync em qualquer falha de `enqueue` pode coexistir com job já enfileirado (timeout/ack/jobId exists). |
| **P1** | Stall + `finalizeWebhookEvent` sem CAS/`updateMany(status=RECEIVED)` permite dois processamentos concorrentes do mesmo evento. |
| **P2** | Eventos sem `externalEventId` geram múltiplos jobs “legítimos”. |

Mitigações existentes (messages): `externalMessageId`. Residual maior em **connection** e alguns **delivery** paths.

### 4.2 Perda de mensagem

| Severidade | Descrição |
|---|---|
| **P1** | Workers parados / flag on sem consumidor → `WebhookEvent` fica `RECEIVED` indefinidamente (alerta só com waiting ≥ 100). |
| **P1** | Perda de dados Redis (flush/eviction) → jobs somem; eventos `RECEIVED` órfãos sem reconcile inbound. |
| **P2** | Falha ao gravar DLQ: job permanece em `failed` (bounded 5000) — não é perda imediata, mas pode ser podado depois. |

Não há caminho óbvio de “ack HTTP + drop sem persistir”: o fluxo cria `WebhookEvent` **antes** do enqueue.

### 4.3 Backlog infinito

| Severidade | Descrição |
|---|---|
| **P1** | Sem rate-limit de profundidade / pausa de producer / rejeição no webhook quando waiting alto. |
| **P2** | Alerta `QUEUE_BACKLOG_HIGH` (≥ 100) existe, mas só warning em Ops — não degrada ingestão. |
| **P2** | Concurrency efetiva fixa em 10/process; escala horizontal sem teto global. |

### 4.4 DLQ crescer sem limite

| Severidade | Descrição |
|---|---|
| **P1** | `removeOnComplete/Fail: false` + sem TTL/max + sem discard/replay API → crescimento ilimitado de chaves Redis. |
| **P2** | Alerta `QUEUE_DLQ_DEPTH > 0` ajuda detecção, não contenção. |

### 4.5 Race conditions

| Severidade | Descrição |
|---|---|
| **P1** | Sync∥async (fallback) e stall∥active sem claim. |
| **P2** | `onFailed` DLQ move vs `removeOnFail` da fila principal — ordem operacional ok na prática, mas sem transação. |
| **P2** | Dois clients Redis (app vs Bull) com políticas diferentes sob partição de rede. |

---

## 5. Achados classificados

### P0 — bloquear enablement prod / corrigir antes de tráfego async real

*Nenhum P0 isolado com flag default off.*

Com **`ASYNC_INBOUND_ENABLED=true` em produção**, os itens P1 de dual-path e claim elevam-se a **bloqueadores de enablement** (tratar como P0 de go-live da flag, não da existência do código 7.1).

### P1 — obrigatório antes de flag ON / logo no início da 7.2

1. **Fail-open seletivo no enqueue** — distinguir: Redis down / timeout ambíguo vs `JobId already exists` vs erro de serialização. Nunca sync-fallback se o job puder já existir; preferir idempotent return `{ queued: true }` no exists.
2. **Claim atômico do `WebhookEvent`** — `updateMany` `RECEIVED|FAILED → PROCESSING` (ou equivalente) antes do domínio; skip se 0 rows.
3. **Teto/TTL na DLQ** (ou política `removeOnComplete` com retenção + alerta hard) + plano de replay/discard.
4. **Graceful shutdown com drain** — `worker.close()` / timeout ≥ `lockDuration` path; documentar preStop.
5. **Métricas honestas** — não zerar counts em erro (expor `queuesUnavailable` / degradar health); age/waiting p95 ou oldest job.
6. **Reconcile / alerta de `RECEIVED` stale** — cobrir perda Redis e workers down abaixo do limiar 100.

### P2 — melhorar na 7.2 sem bloquear scaffold

1. Ligar `ASYNC_INBOUND_CONCURRENCY` de verdade no Worker (factory/register).
2. Validar `payload.v`; unknown → fail definitivo → DLQ.
3. Jitter no backoff; classificação de erros não-retriáveis no inbound.
4. Métricas `job_duration_ms`, retries, stalled; correlation em audit inbound.
5. Unificar ou instrumentar connection Bull vs `RedisService`.
6. Heartbeat de worker opcional em readiness.

---

## 6. Matriz critério × veredito

| # | Critério | Veredito |
|---|---|---|
| 1 | Idempotência | **Parcial** — jobId + skip terminal ok; claim + fallback sync fracos |
| 2 | Retries | **OK** para 7.1 |
| 3 | DLQ | **Parcial** — move ok; unbounded |
| 4 | Correlation IDs | **OK básico** — sem persistência DB |
| 5 | Graceful shutdown | **Parcial** — hooks só |
| 6 | Memory leaks | **Parcial** — main bounded; DLQ não |
| 7 | Concurrency | **Parcial** — default ok; env ignorado |
| 8 | Redis reconnection | **OK mínimo** |
| 9 | Job duplication | **Parcial** — dedupe job ok; processamento duplo residual |
| 10 | Observabilidade | **Parcial** — counts/alertas; buracos e falso zero |

---

## 7. O que está sólido (não reabrir sem motivo)

- Separação QueueModule / WorkerModule / `worker.main` (A2).
- Flag default sync + fallback consciente para não deixar `RECEIVED` órfão em blip Redis.
- Domínio inbound/delivery/connection **não reescrito** — só orquestração.
- Prefixo Redis `autopilot:bq`; nome DLQ compatível com BullMQ.
- Peer `bullmq@5` alinhado a `@nestjs/bullmq@11` (fix CI).
- Testes unitários de producer (jobId/correlation) e processor (DLQ só no attempt final).

---

## 8. Recomendações para destravar 7.2

**Ordem sugerida (sem implementar aqui):**

1. Fechar P1 #1 e #2 (dual-path + claim) — contrato de at-least-once seguro.  
2. Fechar P1 #3 e #5 (DLQ bound + métricas honestas) — operar a foundation.  
3. Em paralelo, scaffold 7.2 **atrás de flags off**, reusando producer patterns **já corrigidos**.  
4. Não ligar `ASYNC_INBOUND_ENABLED=true` em prod até P1 #1–#6.

---

## 9. Veredito final

| Pergunta | Resposta |
|---|---|
| Fundação 7.1 estruturalmente entregue? | **Sim** |
| Aprovada para **ligar async inbound em produção**? | **Não** |
| Aprovada para **começar implementação 7.2 no código**? | **Sim, condicional** — com P1 em paralelo e flags novas default off |
| Rótulo único pedido | **`ajustes necessários`** |

**Motivo do rótulo:** a checklist de robustez (idempotência sob falha, drain, DLQ bounded, observabilidade sem falso verde, concurrency config real) ainda tem gaps P1 materiais. A 7.2 pode avançar como código atrás de flags, mas **não** deve herdar estes gaps como “já resolvidos pela 7.1”.
)
