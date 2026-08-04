# Fase 6B — Channel Hardening Design

**Status:** Design para aprovação (**sem implementação**)  
**Fase:** 6B — Channel Hardening  
**Origem:** `architecture-audit.md` (R3, R4, R5, R13) + gaps WhatsApp Fases 1–4 + `access-hardening-design.md` (ponte 6A→6B)  
**Pré-requisitos:** WhatsApp Fases 1–4, Ops 4.5, Follow-Ups, AI Assist MVP, P0 Hardening, Fase 6A (Access Hardening)  
**Restrições desta etapa de design:**
- **Sem código**
- **Sem migrations aplicadas**
- **Sem alteração de schema**
- Filas/workers descritos como **estratégia futura** (Fase 7+), não implementação nesta fase

---

## 1. Objetivo

Tornar o canal WhatsApp/Evolution **fail-bounded e observável** sob falha de rede, lentidão, indisponibilidade, reconnect e rate limit do provedor — sem mudar o domínio do produto (leads, conversas, follow-ups).

```text
Hoje (gap):
  EvolutionClient.request() = fetch sem timeout/retry/circuit
  Webhook 100% síncrono + @SkipThrottle
  Send / FollowUp.execute bloqueiam no hang do provedor
  Ops health só olha WhatsAppInstance.CONNECTED (DB), não Evolution HTTP

6B (alvo):
  Evolution I/O com timeout + classificação de erro
  Retry seguro (só onde idempotente) + backoff
  Circuit breaker fail-fast quando Evolution está doente
  Orçamento de tempo no webhook + métricas/alertas
  Send / FollowUp protegidos contra hang
  Caminho claro para workers (Fase 7) sem retrabalho
```

### 1.1 Dentro do escopo 6B (design)

| Tema | Entrega de design |
|---|---|
| Evolution timeout | Política por operação + AbortSignal |
| Retry strategy | O que pode / não pode retentar |
| Exponential backoff | Fórmula, jitter, tetos |
| Circuit breaker | Estados, limiares, half-open |
| Webhook processing time | Orçamento, backpressure leve (sem fila ainda) |
| Evolution unavailable / slow / reconnect | Comportamentos e UX API |
| Rate limiting do provedor | Tratamento de 429 |
| Falhas de rede | Taxonomia de erros |
| Impacto FollowUp / send / inbound | Contratos e estados |
| Workers futuros | Interface e fronteira Fase 7 |
| Métricas | Contadores/histogramas necessários |
| Ops reconcile caps | Limite de batch (R6) |

### 1.2 Fora do escopo 6B

- Implementação de código nesta etapa  
- Migrations / alteração de schema  
- BullMQ / workers reais (Fase 7)  
- Troca de provedor WhatsApp  
- Auto-send / campanhas em massa  
- Helmet/CORS (borda HTTP genérica — fase adjacente, não canal)  
- Replay automático de webhooks  
- Mudança de contrato de produto das APIs de Lead/Conversation  

---

## 2. Estado atual (baseline)

### 2.1 O que já existe (bom)

| Capacidade | Onde |
|---|---|
| Adapter Evolution + stub fail-closed (P0) | `evolution.client.ts` |
| Message `PENDING` antes do send (P3-O1) | `whatsapp-send.service.ts` |
| Falha de send → `FAILED` + audit + 502 | outbound |
| Webhook secret + tenant via `WhatsAppInstance.companyId` | `whatsapp.service.ts` |
| Idempotência `WebhookEvent.externalEventId` | inbound |
| Delivery status machine monotônica | `message-status.ts` |
| Echo heal (2 min) | `whatsapp-delivery.service.ts` |
| FollowUp `assertConnected` antes de EXECUTING | `follow-up.service.ts` |
| Lazy timeout EXECUTING 5m + Ops reconcile | FollowUp / Ops |
| Ops alerts: NOT_CONNECTED, PENDING stale, webhook FAILED | `ops.service.ts` |
| OpenAI com `AbortController` 25s (paridade desejada) | `openai.client.ts` |

### 2.2 Gaps que a 6B fecha

| Gap | Efeito |
|---|---|
| `fetch` Evolution **sem timeout** (audit **R3**) | Request Nest pode travar indefinidamente; satura workers |
| Sem retry / backoff | Falhas transitórias viram FAILED imediato ou hang |
| Sem circuit breaker | Storm de calls contra Evolution morto |
| Webhook **100% sync** + `@SkipThrottle` (**R4**) | Burst → pressão Postgres; sem orçamento de tempo |
| Ops health sem probe Evolution | “CONNECTED” no DB enquanto API Evolution está down |
| Send/FollowUp compartilham hang | EXECUTING/PENDING prolongados até reconcile |
| 429 do provedor não classificado | Tratado como erro genérico |
| Sem métricas de latência Evolution | Ops só agrega contagens SQL |
| Reconcile sem `take` cap (audit **R6**) | Batch potencialmente grande |

### 2.3 Arquivos-âncora

| Área | Path | Símbolos |
|---|---|---|
| Evolution | `src/modules/whatsapp/evolution.client.ts` | `request`, `sendText`, `ensureInstanceAndQr` |
| Send | `.../outbound/whatsapp-send.service.ts` | `send`, `assertConnected` |
| Webhook | `whatsapp.service.ts`, `whatsapp.controller.ts` | `handleWebhook` (`@SkipThrottle`) |
| Inbound | `inbound/whatsapp-inbound.service.ts` | `processInboundMessage` |
| Delivery | `outbound/whatsapp-delivery.service.ts` | `applyDeliveryUpdate` |
| FollowUp | `follow-up/follow-up.service.ts` | `execute`, `runWhatsAppSend` |
| Ops | `ops/ops.service.ts` | `getHealth`, `getAlerts`, `reconcile*` |

---

## 3. Princípios de canal (6B)

1. **Fail-bounded:** toda chamada Evolution tem deadline; hang infinito é bug.  
2. **Fail-closed no produto, fail-fast no I/O:** se o canal não pode garantir entrega segura → `FAILED` / `503` / `409`, nunca “PENDING eterno” sem reconcile.  
3. **Não inventar entrega:** retry de `sendText` só com regra anti-duplicata explícita (ver §5).  
4. **Session/tenant já endurecidos na 6A:** 6B não reabre auth; usa `JWT.cid` / instance.companyId como hoje.  
5. **Observabilidade antes de escala:** métricas e classificação de erro vêm junto com timeout/CB.  
6. **Sync hoje, async amanhã:** 6B endurece o caminho sync; workers (Fase 7) reusam a mesma taxonomia/circuit.  
7. **Provedor é hostil:** timeout, 429, 5xx, DNS, TCP reset e reconnect storm são casos de primeira classe.

---

## 4. Fluxos

### 4.1 Outbound send (humano / API)

```text
POST /whatsapp/send
  → assert company + lead + conversation OPEN
  → assertConnected (instance CONNECTED)          [já existe]
  → [NOVO] circuit breaker allow? senão 503 CHANNEL_UNAVAILABLE
  → Message PENDING
  → Evolution.sendText (timeout T_send)
       OK     → SENT + externalMessageId + audit
       TIMEOUT/NETWORK/5xx (após política retry) → FAILED + 502
       429    → FAILED (ou DEFERRED futuro) + audit reason=RATE_LIMIT
       4xx    → FAILED sem retry + 502
  → delivery webhooks posteriores atualizam DELIVERED/READ
```

### 4.2 FollowUp execute / retry

```text
POST /follow-ups/:id/execute
  → assertConnected                                 [já existe; não queima attempt]
  → [NOVO] circuit open? → 503 (não claim EXECUTING)
  → claim SCHEDULED|FAILED → EXECUTING
  → WhatsappSendService.send (mesmo path 4.1)
       OK  → EXECUTED + resultMessageId
       ERR → FAILED + lastError; attempt++
  → [GARANTIA] Evolution timeout ≪ FOLLOWUP_EXECUTING_TIMEOUT (5m)
```

### 4.3 Inbound webhook

```text
POST /whatsapp/webhook/:instanceKey   (@SkipThrottle hoje)
  → validate secret (sync, obrigatório)
  → persist WebhookEvent RECEIVED (idempotent)
  → [NOVO] budget de processamento / classificação lenta
  → route:
       CONNECTION_UPDATE → atualiza status instance
       MESSAGES_UPDATE   → delivery / FAILED
       MESSAGES_UPSERT    → inbound TX (lead+conv+msg) ou echo heal
  → PROCESSED | IGNORED | DUPLICATE | FAILED
  → se erro após RECEIVED: marca FAILED; Evolution pode reenviar
```

### 4.4 Connect / reconnect

```text
POST /whatsapp/connect
  → ensureInstanceAndQr (create + webhook + QR)
  → cada hop Evolution com timeout T_connect
  → [NOVO] backoff se connect martelado (por company/instance)
  → status CONNECTING → QR; CONNECTION_UPDATE → CONNECTED|DISCONNECTED
  → logout Evolution em disconnect: best-effort (já ignora falha)
```

### 4.5 Evolution unavailable / slow (visão operacional)

```text
Evolution down:
  sends → CB abre após N falhas → 503 fail-fast
  webhooks param de chegar → Ops WHATSAPP_NOT_CONNECTED / stale alerts
  FollowUp execute → 503 antes de EXECUTING

Evolution slow (p95 > budget):
  timeouts incrementam falhas do CB
  PENDING/FAILED sobem; reconcile limpa PENDING órfão

Evolution reconnect storm:
  CONNECTION_UPDATE flip-flop → rate-limit updates? (log+métrica; status final vence)
  connect API com cooldown por instance
```

---

## 5. Estados

### 5.1 Message (outbound) — inalterado semanticamente

| Estado | Significado na 6B |
|---|---|
| `PENDING` | Aceito localmente; Evolution ainda não confirmou (janela curta se timeout OK) |
| `SENT` | Evolution aceitou; aguarda ack |
| `DELIVERED` / `READ` | Acks |
| `FAILED` | Timeout, rede, 4xx/5xx esgotados, 429, CB open no momento do send*, ou reconcile `PENDING_TIMEOUT` |

\*Preferência de design: se CB **já open** no início do send, **não criar** Message PENDING — retornar `503` (evita lixo). Se CB abre mid-flight, a tentativa em curso ainda finaliza PENDING→FAILED.

### 5.2 FollowUp — inalterado semanticamente

| Estado | 6B |
|---|---|
| `SCHEDULED` | Aguarda execute manual (sem worker ainda) |
| `EXECUTING` | Send em voo; duração limitada pelo timeout Evolution |
| `EXECUTED` / `FAILED` / `CANCELLED` | Como hoje |
| Max attempts | 3 (manual retry) |

### 5.3 WebhookEvent — inalterado

`RECEIVED → PROCESSED | IGNORED | DUPLICATE | FAILED`

### 5.4 WhatsAppInstance.status — inalterado

`CREATED | CONNECTING | CONNECTED | DISCONNECTED | ERROR`  
6B não muda o enum; adiciona **sinais operacionais** (circuit, latência) fora do enum de domínio.

### 5.5 Circuit breaker (novo estado de infra)

| Estado | Significado |
|---|---|
| `CLOSED` | Tráfego normal para Evolution |
| `OPEN` | Fail-fast; não chama Evolution (exceto probe half-open) |
| `HALF_OPEN` | Permite N probes; sucesso → CLOSED; falha → OPEN |

Escopo do breaker: **process-local por réplica** na 6B.1 (in-memory). Redis compartilhado = evolução 6B.2 / Fase 7 se multi-réplica exigir.

### 5.6 Taxonomia de erro Evolution (nova)

| Classe | Exemplos | Retry? |
|---|---|---|
| `TIMEOUT` | AbortError / deadline | Condicional (§6) |
| `NETWORK` | ECONNRESET, ENOTFOUND, ECONNREFUSED | Condicional |
| `RATE_LIMIT` | HTTP 429 | Condicional com Respect Retry-After |
| `PROVIDER_5XX` | 500/502/503/504 | Condicional |
| `PROVIDER_4XX` | 400/401/403/404 | **Não** |
| `STUB_FORBIDDEN` | stub em prod | **Não** |
| `CIRCUIT_OPEN` | breaker open | **Não** (fail-fast) |
| `UNKNOWN` | demais | **Não** por padrão |

---

## 6. Estratégia de retry

### 6.1 Regras gerais

1. Retry **só para erros transitórios** (`TIMEOUT`, `NETWORK`, `PROVIDER_5XX`, `RATE_LIMIT`).  
2. **Máximo de tentativas por chamada client:** `R_max = 2` retries ⇒ **3 tentativas totais** (1 + 2).  
3. Backoff exponencial com jitter (§7).  
4. Budget total da operação não pode exceder o timeout da operação (`T_op`); se o próximo sleep + tentativa estourar o budget → para e falha.  
5. Cada tentativa conta para o circuit breaker (falha/sucesso).

### 6.2 Por operação

| Operação | Idempotente? | Retry na 6B | Notas |
|---|---|---|---|
| `fetchQr` / GET status | Sim | **Sim** | Seguro |
| `setWebhook` | Quase (upsert) | **Sim** (limitado) | 4xx não |
| `createInstance` | Parcial (já engole “exists”) | **Sim** só NETWORK/5xx | Manter swallow de “already exists” |
| `logout` | Best-effort | **Não** (ou 1 retry NETWORK) | Disconnect não bloqueia UX |
| **`sendText`** | **Não** (risco duplicata) | **Não por padrão** | Ver §6.3 |
| Webhook handler (nosso lado) | N/A | Evolution reenvia em non-2xx | Não fazer retry interno de domínio |

### 6.3 SendText — política anti-duplicata (decisão crítica)

**Problema:** timeout após Evolution já ter aceito a mensagem → retry cego cria **duas** mensagens no WhatsApp.

**Política proposta (CH-SEND-RETRY):**

| Opção | Descrição | Recomendação 6B |
|---|---|---|
| A | Nunca retentar `sendText` | **Default 6B.1** — simples, seguro |
| B | Retry só `NETWORK` antes de bytes úteis (difícil garantir) | Não |
| C | Idempotency-Key / client message id Evolution | Fase 7+ se API suportar |
| D | Em TIMEOUT: marcar `FAILED` com reason `UNCERTAIN_TIMEOUT`; Ops/humano decide; **não** auto-retry | Complemento de A |

**Recomendação:** **A + D** na implementação 6B.  
FollowUp manual `retry` continua sendo o único “retry de negócio” (cria **nova** Message — já documentado na Fase 4).

### 6.4 Rate limit (429)

```text
Recebeu 429:
  → class RATE_LIMIT
  → se Retry-After presente: wait min(Retry-After, B_max) uma vez (conta como retry)
  → se ainda 429 ou sem header: falha RATE_LIMIT
  → sendText: Message FAILED reason=RATE_LIMIT; HTTP 502 ou 429 mapeado na API (ver decisões)
  → incremento métrica evolution_rate_limited_total
  → contribui para abrir CB se sustained
```

### 6.5 Falhas de rede

```text
DNS / connection refused / reset / socket hang up
  → class NETWORK
  → retry com backoff (ops idempotentes)
  → sendText: sem retry (A); FAILED + audit
  → alimenta CB
```

---

## 7. Estratégia de timeout

### 7.1 Timeouts propostos (configuráveis)

| Constante | Default proposto | Uso |
|---|---|---|
| `EVOLUTION_TIMEOUT_SEND_MS` | **15_000** | `sendText` |
| `EVOLUTION_TIMEOUT_CONNECT_MS` | **20_000** | create + webhook + QR (por hop ou budget total — ver CH) |
| `EVOLUTION_TIMEOUT_DEFAULT_MS` | **10_000** | demais calls |
| `EVOLUTION_RETRY_MAX` | **2** | retries (não sendText) |
| `EVOLUTION_CB_*` | ver §8 | circuit breaker |

Paridade: OpenAI usa **25s**; send WhatsApp deve ser **mais agressivo** (15s) porque bloqueia UX e FollowUp EXECUTING.

### 7.2 Implementação alvo (design)

- `AbortController` + `setTimeout` → `signal` no `fetch` (igual OpenAI).  
- Em abort → erro tipado `TIMEOUT`.  
- Connect: **budget total** `T_connect` para a sequência create→webhook→QR; hops individuais ≤ `T_connect` (não N×20s).  
- Timeout do Nest/HTTP proxy (se houver) deve ser **>** `T_send` + margem (ex. 30s) para a API conseguir gravar FAILED.

### 7.3 Relação com timeouts existentes

| Mecanismo | Valor hoje | Relação 6B |
|---|---|---|
| FollowUp EXECUTING lazy | 5 min | Deve permanecer **muito maior** que `T_send`; vira rede de segurança, não path feliz |
| Ops PENDING reconcile | 5 min | Idem; com timeout Evolution, PENDING órfão só em crash de processo |
| Redis connect | 2s | Independente |
| AI OpenAI | 25s | Referência de padrão AbortSignal |

### 7.4 Webhook processing time

Sem fila na 6B, o handler continua sync. Design define **orçamento observável**, não cut-off cego no meio da TX:

| Etapa | Budget alvo |
|---|---|
| Secret verify + load instance | < 100ms p95 |
| Persist WebhookEvent | < 50ms p95 |
| Inbound TX completa | < 500ms p95 (piloto) |
| Handler total | **alerta** se > `WEBHOOK_SLOW_MS` (proposta **2_000**) |
| Handler total crítico | log error se > **5_000**; ainda retorna 200 se domínio ok |

**Não** retornar 500 só por lentidão se a mensagem já foi commitada (evita reprocessamento duplicado do provedor).  
Se falha **antes** de commit de domínio → pode 5xx para Evolution reenviar (já é o comportamento com WebhookEvent FAILED).

**Backpressure leve (6B, sem fila):**

- Métrica + alerta `webhook_slow`  
- Opcional: semáforo in-process `MAX_INFLIGHT_WEBHOOKS` (ex. 50/réplica) → 503 para Evolution retry depois  
- **Não** remover `@SkipThrottle` sem substituto (Evolution usa secret; throttle IP-based quebra bursts legítimos). Preferir semáforo + Fase 7 fila.

---

## 8. Circuit breaker design

### 8.1 Escopo

- **Alvo:** host Evolution (`EVOLUTION_API_URL`), compartilhado por todas as companies na réplica.  
- **Não** abrir breaker por company (uma company CONNECTED ruim não deve bloquear outra) — *exceto* se no futuro houver multi-Evolution; então chavear por base URL.  
- Estado: in-memory 6B.1.

### 8.2 Parâmetros propostos

| Parâmetro | Default | Descrição |
|---|---|---|
| `EVOLUTION_CB_FAILURE_THRESHOLD` | **5** | Falhas consecutivas (ou janela) para OPEN |
| `EVOLUTION_CB_SUCCESS_THRESHOLD` | **2** | Sucessos em HALF_OPEN → CLOSED |
| `EVOLUTION_CB_OPEN_MS` | **30_000** | Tempo em OPEN antes de HALF_OPEN |
| `EVOLUTION_CB_HALF_OPEN_MAX_CALLS` | **1** | Probes paralelos |
| Janela | Consecutiva (simples) | Alternativa: 50% erro em 20 calls — fase posterior |

**Falhas que contam:** `TIMEOUT`, `NETWORK`, `PROVIDER_5XX`, `RATE_LIMIT` (sustained).  
**Não contam para abrir:** `PROVIDER_4XX` de negócio (ex. payload inválido), stub forbidden.

### 8.3 Comportamento por estado

```text
CLOSED:
  calls normais; falha++ / sucesso reseta contador

OPEN:
  send / connect / follow-up execute → 503 CHANNEL_UNAVAILABLE (sem PENDING)
  webhook inbound: **não** depende de Evolution HTTP → continua processando
  delivery: idem
  métrica evolution_circuit_state = open

HALF_OPEN:
  1 probe (ex. fetchQr leve ou send? preferir GET/health se existir; senão fetchQr da instance de ops)
  sucesso → CLOSED; falha → OPEN remanescente
```

**Probe recomendado:** endpoint de presença leve (se Evolution expuser) ou `fetchQr` read-only; **evitar** `sendText` como probe.

### 8.4 Interação com stub mode

Stub (dev/test): circuit breaker **desligado** ou sempre CLOSED.  
Prod sem URL: stub forbidden (P0) — CB irrelevante.

---

## 9. Métricas necessárias

### 9.1 Contadores

| Métrica | Labels úteis |
|---|---|
| `evolution_requests_total` | `operation`, `result` (ok\|timeout\|network\|4xx\|5xx\|429\|circuit_open) |
| `evolution_retries_total` | `operation` |
| `evolution_circuit_transitions_total` | `from`, `to` |
| `whatsapp_send_total` | `result` (sent\|failed\|rejected_connected\|rejected_circuit) |
| `whatsapp_webhook_total` | `event_type`, `result` (processed\|ignored\|duplicate\|failed) |
| `whatsapp_webhook_inflight` | gauge |
| `followup_execute_total` | `result` |

### 9.2 Histogramas / timings

| Métrica | Objetivo |
|---|---|
| `evolution_request_duration_ms` | p50/p95/p99 por operation |
| `whatsapp_webhook_processing_ms` | orçamento §7.4 |
| `whatsapp_send_total_ms` | inclui DB + Evolution |

### 9.3 Exposição na 6B

**Mínimo viável sem Prometheus exporter:**

1. Estender `GET /ops/metrics` e `GET /ops/alerts` com:
   - `evolutionCircuitState`
   - `evolutionTimeoutsLast15m` (via logs estruturados **ou** contador in-memory por réplica)
   - `webhookP95Ms` / `webhookSlowLast15m` (in-memory rolling)
   - alerta `EVOLUTION_CIRCUIT_OPEN`
   - alerta `EVOLUTION_HIGH_TIMEOUT_RATE`
   - alerta `WEBHOOK_SLOW`

2. Logs estruturados Nest: `operation`, `durationMs`, `errorClass`, `instanceName` (sem secrets).

**Prometheus nativo:** desejável, mas pode ficar 6B.2 / Fase Ops se o JSON Ops for suficiente para piloto.

### 9.4 Health

| Endpoint | 6B |
|---|---|
| `/ready` | Continua Postgres+Redis (não Evolution — Evolution down ≠ pod unready) |
| `/ops/health` | Adiciona `evolution: { circuit, lastErrorAt?, stubMode }` além de `whatsappConnected` DB |

---

## 10. Impacto em FollowUp

| Aspecto | Hoje | Após 6B |
|---|---|---|
| Execute bloqueia em Evolution | Sim, sem teto | Sim, mas **≤ T_send (+ retries connect-only N/A)** |
| `assertConnected` | 409, sem EXECUTING | Mantém + check CB → 503 sem EXECUTING |
| Attempts | Manual, max 3 | Mantém; timeout vira FAILED com `lastError` classificado |
| Worker automático | Não | Continua não (Fase 7); 6B só torna execute seguro |
| EXECUTING 5m reconcile | Rede de segurança | Quase só crash; path feliz ≪ 5m |
| Duplicata em retry manual | Nova Message | Igual; documentar que é intencional |

**Regra:** nunca claim `EXECUTING` se CB OPEN ou instance ≠ CONNECTED.

---

## 11. Impacto em WhatsApp send

| Aspecto | Hoje | Após 6B |
|---|---|---|
| PENDING pré-send | Sim | Mantém se passou CB |
| Hang infinito | Possível | Impossível (AbortSignal) |
| Retry sendText | Não | Continua não (anti-duplicata) |
| Erro | 502 genérico | 502/503 + `errorClass` no audit `errorMessage` |
| CB open | N/A | 503 sem PENDING |
| 429 | FAILED genérico | FAILED `RATE_LIMIT` |
| TIMEOUT incerto | N/A | FAILED `UNCERTAIN_TIMEOUT` (possível falsa falha se Evolution aceitou) |

**Risco residual aceito:** timeout após accept do provedor → Message FAILED local, WhatsApp pode ter entregue; delivery/echo heal podem reconciliar se `externalMessageId` chegar depois (echo heal 2m). Documentar runbook: se echo heal anexar, status pode subir SENT mesmo após FAILED? **Hoje a máquina de estados não prevê FAILED→SENT.**  

**Decisão necessária (CH-FAILED-HEAL):**

| Opção | Descrição | Recomendação |
|---|---|---|
| A | Manter FAILED terminal; echo não reabre | Simples; possível inconsistência UX |
| B | Permitir FAILED→SENT só via echo heal com match forte | Mais correto; mudança pequena em `message-status` |
| C | Novo estado `UNKNOWN` | Schema — **fora** 6B |

**Recomendação design:** **B** na implementação (sem migration: só transição de status), com audit `WHATSAPP_MESSAGE_UNCERTAIN_RESOLVED`.

---

## 12. Impacto em inbound webhook

| Aspecto | Hoje | Após 6B |
|---|---|---|
| Sync domain TX | Sim | Mantém |
| SkipThrottle | Sim | Mantém (com semáforo opcional) |
| Dependência Evolution HTTP | Não no path inbound | Continua independente do CB |
| Lentidão | Sem métrica | Histogram + alerta + inflight cap |
| CONNECTION_UPDATE storm | Update direto | Métrica `connection_flaps`; last-write-wins |
| Erros | FAILED + rethrow | Igual; classificar erros internos |

Inbound **não** deve abrir o circuit breaker (não chama Evolution).  
Disconnect/reconnect do Baileys continua via webhook de connection.

---

## 13. Estratégia futura para workers (Fase 7 — não implementar)

A 6B deve deixar **contratos** prontos para:

```text
Fase 7 (visão):
  Webhook HTTP → validate secret → enqueue (Redis/BullMQ) → 202/200 rápido
  Worker inbound → processInboundMessage (mesmo serviço)
  Worker outbound → send com mesma taxonomia/timeout/CB
  Worker followup → poll SCHEDULED due → execute

6B prepara:
  ✓ EvolutionClient com timeout/retry/CB/error classes
  ✓ Semáforo / métricas de inflight webhook
  ✓ Política sendText sem retry cego
  ✓ Ops alerts de canal
  ✗ Filas, jobs, concurrency por company
```

**Fronteira explícita:** nenhuma API muda para “aceito async” na 6B; workers são aditivos depois.

Comentário já existente no inbound (“sync today; queue-ready tomorrow”) permanece a intenção.

---

## 14. Pacotes de trabalho — P6B-1 … P6B-N

| ID | Pacote | Escopo | Dependências | Risco |
|---|---|---|---|---|
| **P6B-1** | Timeout + AbortSignal no `EvolutionClient` | Timeouts por operação; erro `TIMEOUT`; config env | — | Baixo |
| **P6B-2** | Taxonomia de erros + logging estruturado | Classes §5.6; audit `errorMessage` estável | P6B-1 | Baixo |
| **P6B-3** | Retry + exponential backoff (ops idempotentes) | create/setWebhook/fetchQr; **não** sendText | P6B-1, P6B-2 | Médio |
| **P6B-4** | Circuit breaker in-memory | CLOSED/OPEN/HALF_OPEN; 503 CHANNEL_UNAVAILABLE | P6B-1, P6B-2 | Médio |
| **P6B-5** | Proteção send + FollowUp | CB check pré-PENDING/pré-EXECUTING; FAILED reasons | P6B-4 | Médio |
| **P6B-6** | Heal FAILED→SENT via echo (UNCERTAIN_TIMEOUT) | Transição status + audit | P6B-2, P6B-5 | Médio |
| **P6B-7** | Webhook budget + inflight semaphore | Métricas slow; cap inflight; **sem** fila | — | Médio |
| **P6B-8** | Ops metrics/alerts/health Evolution | Circuit, timeouts, webhook slow; reconcile `take` cap | P6B-4, P6B-7 | Baixo |
| **P6B-9** | Connect reconnect cooldown | Evitar martelar create/QR | P6B-1, P6B-3 | Baixo |
| **P6B-10** | Testes (unit + e2e canal) | Mock fetch abort, CB, 429, FollowUp 503 | P6B-1…9 | — |
| **P6B-11** | Review doc `channel-hardening-review.md` | Fluxo final, testes, riscos residuais | P6B-10 | — |

### 14.1 Fases de implementação sugeridas (após aprovação)

```text
6B.1  P6B-1 → P6B-5 → P6B-8 (parcial) → P6B-10   # núcleo disponibilidade
6B.2  P6B-6 → P6B-7 → P6B-9 → P6B-8 (completo) → P6B-11
6B.3  (opcional) CB Redis compartilhado / Prometheus exporter
```

**Sem schema / sem migrations** em 6B.1–6B.2.

---

## 15. Decisões para aprovação (CH1–CH12)

| ID | Pergunta | Proposta |
|---|---|---|
| **CH1** | Timeout send default? | **15s** (`EVOLUTION_TIMEOUT_SEND_MS`) |
| **CH2** | Retentar `sendText`? | **Não** (anti-duplicata); FollowUp retry manual permanece |
| **CH3** | TIMEOUT incerto? | FAILED `UNCERTAIN_TIMEOUT` + heal FAILED→SENT via echo (**CH-FAILED-HEAL = B**) |
| **CH4** | Circuit breaker escopo? | Por base URL Evolution, **in-memory** por réplica na 6B.1 |
| **CH5** | CB open no send? | **503** sem criar PENDING |
| **CH6** | CB open no FollowUp execute? | **503** sem claim EXECUTING |
| **CH7** | Webhook vira async na 6B? | **Não** — só budget + semáforo + métricas; fila = Fase 7 |
| **CH8** | Remover `@SkipThrottle` do webhook? | **Não** na 6B; usar inflight cap |
| **CH9** | 429 na API pública de send? | Mapear para **429** (se autenticado) com body estável; Message FAILED |
| **CH10** | `/ready` inclui Evolution? | **Não** — só `/ops/health` |
| **CH11** | Reconcile cap? | `take` default **100** por chamada Ops |
| **CH12** | Helmet/CORS nesta fase? | **Fora** de Channel Hardening (fase borda HTTP separada) |

---

## 16. Exponential backoff (detalhe)

```text
delay_attempt_k = min(B_max, B_base * 2^(k-1)) + random_jitter(0, J)
```

| Parâmetro | Default |
|---|---|
| `B_base` | 200 ms |
| `B_max` | 2_000 ms |
| `J` | 200 ms |
| `R_max` | 2 |

Respeitar `Retry-After` em 429 quando ≤ `B_max` (ou cap dedicado `RATE_LIMIT_WAIT_MAX_MS = 5_000`).

Budget: `sum(delays) + sum(attempt_timeouts) ≤ T_op` (connect) ou política “fail early” se não couber.

---

## 17. Riscos

| ID | Risco | Severidade | Mitigação |
|---|---|---|---|
| CR1 | TIMEOUT após Evolution aceitar → falsa FAILED | Alta | CH3 heal FAILED→SENT; runbook Ops |
| CR2 | CB in-memory diverge entre réplicas | Média | Aceitar 6B.1; Redis CB em 6B.3 se N>1 réplica |
| CR3 | Semáforo webhook 503 → Evolution retry storm | Média | Cap generoso; métricas; Fase 7 fila |
| CR4 | Connect budget corta QR lento | Baixa | `T_connect` 20s; retry idempotente |
| CR5 | Classificação errada de erro Evolution | Média | Testes com fixtures de status/body |
| CR6 | FollowUp UX vê mais 503 | Baixa (desejável) | Melhor que hang; UI pode remarcar |
| CR7 | Escopo creep para filas | Alta (processo) | Fronteira Fase 7 explícita neste doc |
| CR8 | Reconcile ainda necessário pós-crash | Baixa | Manter; adicionar `take` cap |

---

## 18. Rollout

```text
1. Aprovar CH1–CH12
2. Implementar 6B.1 em staging com Evolution real (não stub)
3. Feature flags (opcional):
     EVOLUTION_CB_ENABLED=true
     EVOLUTION_RETRY_ENABLED=true
4. Observar 24–72h piloto:
     - p95 evolution_request_duration_ms
     - taxa TIMEOUT / 429
     - tempo em OPEN do CB
     - webhook_processing_ms
     - PENDING stale count (deve cair)
5. Promover produção controlada (mesmo tier do audit)
6. Só então planejar Fase 7 (workers/filas)
```

**Rollback:** flags off / defaults generosos de timeout; CB disable volta ao comportamento “tenta sempre” (ainda com timeout — rollback parcial seguro).

**Ordem segura de deploy:** P6B-1 (timeout) primeiro — já reduz o pior hang mesmo sem CB.

---

## 19. Critérios de aceite

### 19.1 Funcionais

- [ ] Nenhuma chamada Evolution sem deadline configurável  
- [ ] `sendText` **não** retenta automaticamente  
- [ ] TIMEOUT/NETWORK/5xx/429 classificados em logs/audit  
- [ ] Circuit OPEN → send e FollowUp execute retornam **503** sem PENDING/EXECUTING  
- [ ] Webhook inbound continua funcionando com CB OPEN  
- [ ] Ops expõe estado do circuit + alertas de timeout/slow webhook  
- [ ] Reconcile messages/followups respeita `take` cap  
- [ ] Connect aplica timeouts (e cooldown se P6B-9 incluído)  
- [ ] Echo heal pode resolver `UNCERTAIN_TIMEOUT` (FAILED→SENT) se CH3=B aprovado  
- [ ] Stub fail-closed P0 preservado  

### 19.2 Não-funcionais

- [ ] Testes unitários: abort/timeout, retry idempotente, CB transitions, 429  
- [ ] Testes: FollowUp não claim EXECUTING se CB open  
- [ ] E2E canal (stub ou mock): send failure path permanece 502/FAILED  
- [ ] `channel-hardening-review.md` publicado  
- [ ] **Sem** migrations / **sem** mudança de schema  
- [ ] Fase 7 (filas) **não** iniciada  

### 19.3 Aceite de design (esta entrega)

- [ ] Documento cobre fluxos, estados, retry, timeout, CB, métricas  
- [ ] Impactos FollowUp / send / inbound documentados  
- [ ] Estratégia futura de workers documentada  
- [ ] P6B-1…P6B-11 definidos  
- [ ] Riscos + rollout + critérios de aceite presentes  
- [ ] Decisões CH1–CH12 explícitas para aprovação  

---

## 20. Relação com o roadmap

```text
Fase 6A  Access Hardening          ✅ (membership/session/cache)
Fase 6B  Channel Hardening         ← este design
Fase 7   Async + automation        filas inbound/outbound/followup workers
```

Auditoria: R3 (timeout) e parte de R4 (backpressure leve) entram em 6B; R5/R13 (workers/filas) ficam na Fase 7, conscientemente.

---

## 21. Próximo passo

**Aguardando aprovação das decisões CH1–CH12** e do particionamento P6B-1…P6B-11.  
Somente após aprovação → implementar **6B.1** (código, sem migration) começando por **P6B-1** (timeout).

**Não iniciar implementação nesta entrega.**  
**Não iniciar Fase 7.**
