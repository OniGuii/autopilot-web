# Fase 7.1-H — Async Foundation Hardening Review

**Status:** Implementado  
**Base:** auditoria `async-foundation-audit.md` (PR #28)  
**Escopo:** somente P1 da foundation inbound — **sem 7.2**, sem novos workers/filas de send/follow-up/AI

---

## 1. Mudanças realizadas

| Área | Mudança |
|---|---|
| Dual-path | Com `ASYNC_INBOUND_ENABLED=true`, falha de enqueue → log + `error` no WebhookEvent + **503**. **Nunca** dispatch sync. |
| Sync path | Inalterado quando flag `false` (default / rollback). |
| Claim atômico | `claimWebhookEvent`: `RECEIVED\|FAILED → PROCESSING`; reclaim de `PROCESSING` stale; falha de claim → job encerra sem domínio. |
| Schema | Enum `WebhookEventStatus.PROCESSING` + migration `20260804140000_webhook_event_processing`. |
| DLQ governance | `QUEUE_DLQ_MAX_JOBS`, retention, auto-cleanup (age + overflow). |
| Shutdown | Worker `BeforeApplicationShutdown` → `worker.close()`; `AsyncLifecycleService` pausa/fecha queues. |
| Métricas | `available=false` em falha (sem zeros falsos); duration p95, retries, stalled, claimFailures; `dlqDepth` / `oldestDlqAgeMs`. |
| Órfãos | Contagem `RECEIVED` > stale threshold → alerta `WEBHOOK_EVENT_STALE` (sem auto-replay). |
| Env fail-fast | `QUEUE_CONCURRENCY`, `QUEUE_REMOVE_ON_COMPLETE`, `QUEUE_REMOVE_ON_FAIL` (+ DLQ/stale) via Joi. |

---

## 2. Estratégia de claim

```text
Worker pega job
  → se status terminal → noop (ALREADY_FINAL)
  → updateMany status IN (RECEIVED, FAILED) SET PROCESSING
      count=1 → processa domínio
      count=0 → tenta reclaim se PROCESSING AND updatedAt < now - claimStaleMs
      senão → CLAIM_FAILED (completa job sem processar; métrica claimFailures++)
```

Somente um worker obtém o claim. Stall recovery via reclaim após `WEBHOOK_CLAIM_STALE_MS` (default 45s, alinhado ao lock).

---

## 3. Riscos mitigados

| Risco (audit) | Mitigação |
|---|---|
| Dual-path sync∥async | Removido; 503 + evento permanece `RECEIVED` com `error` |
| Race stall / duplo process | Claim atômico + CLAIM_FAILED |
| DLQ unbounded | max jobs + retention + cleanup |
| Falso verde em métricas | `queues.available` / health degraded |
| RECEIVED órfão silencioso | `WEBHOOK_EVENT_STALE` |
| Shutdown abrupto | drain worker + pause/close queues |
| Concurrency config ignorada | `QUEUE_CONCURRENCY` wired no `@Processor` |

---

## 4. Métricas novas (`GET /api/ops/metrics` → `queues`)

| Campo | Significado |
|---|---|
| `available` | Coleta Bull/Redis ok |
| `error` | Motivo quando unavailable |
| `dlqDepth` / `dlqWhatsappInbound` | Profundidade DLQ (`null` se unavailable) |
| `oldestDlqAgeMs` | Idade do job DLQ mais antigo |
| `processingDurationP95Ms` | p95 duração process (janela 15m, in-process) |
| `retriesTotal` | Contador de retries do worker |
| `stalledTotal` | Contador de stalls |
| `claimFailuresTotal` | Contador de claims perdidos |
| `staleReceivedWebhooks` | (top-level) RECEIVED > threshold |

---

## 5. Alertas novos

| Código | Quando |
|---|---|
| `QUEUE_DLQ_STALE` | `oldestDlqAgeMs >= QUEUE_DLQ_STALE_MS` |
| `WEBHOOK_EVENT_STALE` | `RECEIVED` mais antigo que `WEBHOOK_RECEIVED_STALE_MS` (default 5m) |
| `QUEUE_METRICS_UNAVAILABLE` | Falha na coleta Bull/Redis |

Mantidos: `QUEUE_BACKLOG_HIGH`, `QUEUE_DLQ_DEPTH`.

---

## 6. Comportamento de rollback

1. `ASYNC_INBOUND_ENABLED=false` → webhook 100% sync (comportamento pré-async).  
2. Workers podem drenar fila residual.  
3. Migration `PROCESSING` é aditiva (não quebra sync).  
4. Sem mudanças de contrato no path sync.

---

## 7. Limitações restantes (não-escopo / P2)

- Sem auto-replay de DLQ / RECEIVED órfãos (só detecção).  
- Contadores duration/retries/stalled são **por processo** (não agregados cluster).  
- Validação de `payload.v` / jitter de backoff ainda P2.  
- Heartbeat de worker em `/ready` não adicionado.  
- Fase **7.2** (send / follow-up / AI workers) **não iniciada**.

---

## 8. Variáveis de ambiente (7.1-H)

| Var | Default | Notas |
|---|---|---|
| `QUEUE_CONCURRENCY` | 10 | Fail-fast Joi; wiring no worker |
| `QUEUE_REMOVE_ON_COMPLETE` | 1000 | Producer inbound |
| `QUEUE_REMOVE_ON_FAIL` | 5000 | Producer inbound |
| `QUEUE_DLQ_MAX_JOBS` | 1000 | Cap DLQ |
| `QUEUE_DLQ_RETENTION_MS` | 7d | Cleanup por idade |
| `QUEUE_DLQ_STALE_MS` | 1h | Alerta stale |
| `WEBHOOK_CLAIM_STALE_MS` | 45s | Reclaim PROCESSING |
| `WEBHOOK_RECEIVED_STALE_MS` | 5m | Alerta órfãos |

---

## 9. Veredito

Hardening P1 da foundation **entregue**. Pronto para reavaliação de enablement da flag após validação em staging; **7.2 aguarda aprovação explícita**.
