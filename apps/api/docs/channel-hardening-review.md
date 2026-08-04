# Fase 6B — Channel Hardening Review

**Status:** Implementado (código, sem migration / sem schema)  
**Fase:** 6B — Channel Hardening  
**Decisões:** CH1–CH12 aprovadas + **CH13 Correlation ID**  
**Fora de escopo:** Fase 7 (filas/workers) — **não iniciada**

---

## 1. Resumo executivo

O canal Evolution deixa de poder hangar a API: timeout 15s com `AbortSignal`, taxonomia de erros, circuit breaker in-memory (OPEN → 503), cooldown de connect, heal FAILED→SENT via echo, métricas Ops e correlation id ligando Message / FollowUp / Audit.

---

## 2. Decisões CH1–CH13

| ID | Decisão | Implementação |
|---|---|---|
| CH1 | Timeout send 15s | `EVOLUTION_TIMEOUT_SEND_MS` + AbortSignal |
| CH2 | Não retentar `sendText` | `retryable: false` em sendText |
| CH3 | Heal FAILED→SENT via echo | Status machine + `WHATSAPP_MESSAGE_UNCERTAIN_RESOLVED` |
| CH4 | CB in-memory por réplica | `EvolutionCircuitBreaker` |
| CH5 | OPEN → 503 sem PENDING | `assertAvailable()` antes do create |
| CH6 | FollowUp respeita CB | `assertChannelAvailable()` antes de EXECUTING |
| CH7 | Webhook sync | Mantido; budget + inflight semaphore |
| CH8 | `@SkipThrottle` mantido | Sim; backpressure via `WEBHOOK_MAX_INFLIGHT` |
| CH9 | 429 mapeado | HTTP 429 + Message FAILED `RATE_LIMIT` |
| CH10 | `/ready` sem Evolution | Sim; Evolution só em `/ops/health` |
| CH11 | Reconcile `take` | Default 100 (`OPS_RECONCILE_TAKE`) |
| CH12 | Helmet/CORS fora | Não implementado |
| **CH13** | Correlation ID | Message/FollowUp metadata + Audit before/after |

---

## 3. Estados do Circuit Breaker

```text
CLOSED ──(N falhas transitórias)──► OPEN
OPEN   ──(openMs elapsed)─────────► HALF_OPEN
HALF_OPEN ──(sucesso × M)─────────► CLOSED
HALF_OPEN ──(falha)───────────────► OPEN
```

| Estado | Comportamento |
|---|---|
| `CLOSED` | Calls Evolution normais |
| `OPEN` | Fail-fast `503 CHANNEL_UNAVAILABLE` (send/connect/FollowUp); webhook inbound continua |
| `HALF_OPEN` | 1 probe; sucesso → CLOSED; falha → OPEN |

Falhas que contam: `TIMEOUT`, `NETWORK`, `PROVIDER_5XX`, `RATE_LIMIT`.  
Stub mode / `EVOLUTION_CB_ENABLED=false`: CB efetivamente CLOSED.

Defaults: failureThreshold=5, successThreshold=2, openMs=30s.

---

## 4. Timeout strategy

| Operação | Default | Retry |
|---|---|---|
| `sendText` | **15s** | **Não** |
| connect hops (create/webhook/QR) | 20s | Sim (idempotente) |
| demais | 10s | Conforme op |

- Implementação: `AbortController` + `signal` no `fetch` (paridade OpenAI).  
- TIMEOUT em send → Message FAILED com `UNCERTAIN_TIMEOUT` (possível falsa falha se Evolution aceitou).  
- FollowUp EXECUTING 5m permanece rede de segurança ≫ 15s.

---

## 5. Heal strategy (CH3)

```text
send timeout → Message FAILED (externalMessageId=null, error=UNCERTAIN_TIMEOUT)
     │
     ▼ (≤ 2 min)
echo fromMe upsert (mesmo phone/body)
     │
     ▼
healEchoRace: FAILED|PENDING|SENT(sem id) → SENT + externalMessageId
     │
     ▼
audit WHATSAPP_MESSAGE_UNCERTAIN_RESOLVED (se vinha de FAILED)
```

Transição nova na máquina: **FAILED → SENT** (somente via echo heal).

---

## 6. Correlação de eventos (CH13)

| Superfície | Campo |
|---|---|
| `Message.metadata.correlationId` | UUID gerado no send (ou herdado do FollowUp) |
| `FollowUp.metadata.correlationId` | UUID no claim EXECUTING |
| Audit `before` / `after` | `correlationId` em send/fail/execute/heal |

Permite amarrar FollowUp ↔ Message ↔ Audit sem schema novo.

---

## 7. Métricas Ops

`GET /ops/metrics` ganhou:

- `evolutionCircuitState`
- `evolutionTimeoutsLast15m`
- `evolutionRetriesTotal`
- `webhookP95Ms`
- `webhookSlowLast15m`
- `webhookInflight`

Alertas novos: `EVOLUTION_CIRCUIT_OPEN`, `EVOLUTION_HIGH_TIMEOUT_RATE`, `WEBHOOK_SLOW`.

`GET /ops/health` inclui `evolution: { circuit, lastErrorAt, stubMode }`.  
Circuit OPEN → health `degraded` (não derruba `/ready`).

---

## 8. Arquivos principais

| Arquivo | Papel |
|---|---|
| `evolution.client.ts` | Timeout, retry, CB, cooldown |
| `evolution.errors.ts` | Taxonomia |
| `evolution.circuit-breaker.ts` | Estados CB |
| `evolution.channel-metrics.ts` | Contadores in-memory |
| `correlation.ts` | CH13 helper |
| `whatsapp-send.service.ts` | 503 pré-PENDING + correlation |
| `follow-up.service.ts` | CB + correlation |
| `whatsapp-delivery.service.ts` | Heal FAILED→SENT |
| `message-status.ts` | Transição FAILED→SENT |
| `whatsapp.service.ts` | Webhook inflight + timing |
| `ops.service.ts` | Metrics/alerts/health/reconcile take |

---

## 9. Testes executados

### Unit (`npm test`)

**20 suites / 113 tests — passed**

Cobertura 6B inclui:

- Evolution timeout (AbortSignal)
- CB open → assertAvailable 503
- sendText sem retry
- Circuit breaker transitions
- Send 503 sem PENDING
- FAILED→SENT echo heal + audit
- FollowUp metadata com correlationId
- Ops metrics/health evolution
- Message status FAILED→SENT

### E2E (`npm run test:e2e`)

**3 suites / 12 tests — passed**

### Build

- `npm run build` — OK

---

## 10. Riscos residuais

| Risco | Mitigação |
|---|---|
| TIMEOUT após accept Evolution | Heal echo 2m; runbook Ops |
| CB in-memory diverge entre réplicas | Aceito 6B; Redis CB futuro |
| Webhook 503 backpressure → retry Evolution | Cap generoso (50); Fase 7 fila |
| Sem Prometheus | Ops JSON suficiente para piloto |

---

## 11. Não iniciado

- **Fase 7** (filas / workers / BullMQ)  
- CB Redis compartilhado  
- Helmet/CORS  
- Migrations / schema  

---

## 12. Veredito

**6B entregue.** Canal fail-bounded e observável; pronto para review/merge. Fase 7 não iniciada.
