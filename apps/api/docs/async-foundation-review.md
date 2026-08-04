# Fase 7.1 — Async Foundation Review

**Status:** Implementado (sem migrations / sem schema / sem 7.2)  
**Decisões:** A1–A10 aprovadas + **A11 Job Correlation**  
**Escopo:** BullMQ foundation, inbound queue/worker, DLQ básica, métricas Ops

---

## 1. Resumo

7.1 introduz BullMQ sobre Redis e desacopla o webhook WhatsApp do processamento de domínio via fila `whatsapp-inbound`, com correlationId (A11), DLQ e métricas Ops. Send / FollowUp / AI workers **não** foram implementados (7.2).

---

## 2. Filas criadas

| Fila BullMQ | Prefixo Redis | Uso |
|---|---|---|
| `whatsapp-inbound` | `autopilot:bq` | Processar WebhookEvent RECEIVED |
| `dlq-whatsapp-inbound` | `autopilot:bq` | Dead letters após esgotar attempts |

**Não criadas (7.2):** `whatsapp-send`, `followup-execute`, `ai-suggest`, `reconcile`.

---

## 3. Workers criados

| Worker | Processo | Concurrency default |
|---|---|---|
| `WhatsappInboundProcessor` | API (`ASYNC_WORKERS_IN_API=true`) ou `npm run start:worker` | 10 |

Job name: `process-webhook`  
jobId estável: `webhook:{webhookEventId}`  
Attempts: 5, backoff exponential 2s

---

## 4. Métricas criadas

`GET /ops/metrics` → `queues`:

- `whatsappInbound.{waiting,active,completed,failed,delayed}`
- `dlqWhatsappInbound`

`GET /ops/health` → `queues` (mesmo shape)

Alertas:

- `QUEUE_BACKLOG_HIGH` (waiting ≥ 100)
- `QUEUE_DLQ_DEPTH` (dlq > 0)

---

## 5. Impacto no webhook

```text
Flag OFF (default / rollback):
  secret → RECEIVED → dispatch sync (comportamento 6B)

Flag ON (ASYNC_INBOUND_ENABLED=true):
  secret → RECEIVED → enqueue → { ok, queued, correlationId, jobId }
  worker → processQueuedWebhook → mesmos handlers de domínio

Enqueue falha (Redis):
  fallback sync (evita WebhookEvent preso em RECEIVED)
```

Domínio (inbound/delivery/connection) **não** foi reescrito — só orquestração.

---

## 6. Correlation (A11)

- Gerado no HTTP path (`newCorrelationId`)
- Propagado no job payload
- Retornado na response (`correlationId`)
- Logs do producer/worker incluem `correlationId`

Sem coluna nova em `WebhookEvent` (sem migration).

---

## 7. Estratégia de rollback

1. `ASYNC_INBOUND_ENABLED=false` → webhook volta 100% sync  
2. Workers podem continuar drenando fila residual  
3. `ASYNC_WORKERS_IN_API=false` + parar `start:worker` → para consumo  
4. Nenhuma migration para reverter  

---

## 8. Módulos / entrypoints

| Artefato | Papel |
|---|---|
| `modules/async/queue.module.ts` | Bull connection + queues + producer + DLQ + metrics |
| `modules/async/worker.module.ts` | Processors |
| `worker.main.ts` | Processo dedicado (A2) |
| `npm run start:worker` | Bootstrap workers |

Flags: `ASYNC_INBOUND_ENABLED`, `ASYNC_WORKERS_IN_API`, attempts/backoff/concurrency.

---

## 9. Testes executados

- Unit: suite completa (inclui producer/processor/enqueue)  
- E2E: suite projeto (default sync — flag off)  
- Build: `nest build`  

---

## 10. Não iniciado (7.2)

- whatsapp-send-worker  
- followup-execute-worker  
- ai-suggest-worker  
- reconcile-worker  
- DLQ replay Ops API  

---

## 11. Veredito

**7.1 entregue.** Foundation async + inbound operacional atrás de flag; rollback trivial; domínio preservado.
