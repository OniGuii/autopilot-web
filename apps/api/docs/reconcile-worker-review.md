# Fase 7.2B — Reconcile Worker Review

**Status:** Implementado  
**Escopo:** verificações de consistência operacional via BullMQ  
**Fora de escopo:** AI Worker, Outbound/Send Worker, frontend, mudanças de APIs HTTP

---

## 1. Resumo

Com `ASYNC_RECONCILE_ENABLED=true`, um scheduler enfileira ciclos na fila `reconcile-worker`. O `ReconcileProcessor` processa **por company**, com **take ≤ 100** por ciclo, sem loops infinitos e **sem replay automático** de webhooks/DLQ.

Flag **false** (default): comportamento atual permanece (reconcile só via `POST /ops/reconcile/*` manual).

---

## 2. Componentes

| Artefato | Papel |
|---|---|
| `reconcile-worker` | Fila BullMQ |
| `ReconcileProducer` | Enqueue ciclo (`jobId=reconcile:cycle:{minute}`) |
| `ReconcileScheduler` | Interval + Redis lock |
| `ReconcileProcessor` | Worker |
| `ReconcileCycleService` | Lógica do ciclo |

---

## 3. Itens monitorados

### Messages `PENDING` > 5m
- Identifica e aplica `OpsService.reconcileMessages(apply=true)` → `FAILED` / `PENDING_TIMEOUT`
- Echo heal (`healEchoRace`) continua só no path inbound (precisa do echo); sem payload de echo aqui

### FollowUps `EXECUTING` > 5m
- Marca **suspeito** em `metadata.reconcileSuspect=true` (+ `reconcileSuspectedAt`)
- **Não** altera status (permanece `EXECUTING`; **nunca** toca `EXECUTED`)
- Audit `OPS_RECONCILE_FOLLOWUP_SUSPECT`
- Alertas Ops existentes (`FOLLOWUP_STUCK_EXECUTING` / `EXECUTING_FOLLOWUPS_STALE`) cobrem exposição

### WebhookEvents `RECEIVED` > 5m
- Conta / contribui para métricas
- Alerta `WEBHOOK_EVENT_STALE` (já existente)
- **Sem reprocessar**

### DLQ
- Lê `dlqDepth` / `oldestDlqAgeMs` no fim do ciclo
- Alerta `QUEUE_DLQ_STALE` (já existente)

---

## 4. Proteções

| Regra | Como |
|---|---|
| Por company | Loop companyIds com sinais stale |
| take 100 | Budget compartilhado no ciclo |
| Sem loop infinito | Budget + distinct companies cap |
| Sem replay auto | Webhooks/DLQ só observação |
| Dedupe enqueue | jobId por minuto |

---

## 5. Métricas (`GET /api/ops/metrics` → `queues`)

```json
{
  "reconcileWorker": { "waiting": 0, "active": 0, "completed": 0, "failed": 0 },
  "reconcile": {
    "runs": 1,
    "durationMs": 42,
    "itemsChecked": 10,
    "itemsFlagged": 3
  }
}
```

---

## 6. Flags / env

| Var | Default |
|---|---|
| `ASYNC_RECONCILE_ENABLED` | `false` |
| `RECONCILE_ATTEMPTS` | `2` |
| `RECONCILE_BACKOFF_MS` | `30000` |
| `RECONCILE_CONCURRENCY` | `1` |
| `RECONCILE_SCAN_INTERVAL_MS` | `300000` (5m) |
| `RECONCILE_TAKE` | `100` |

---

## 7. Rollback

`ASYNC_RECONCILE_ENABLED=false` → scheduler para; HTTP Ops reconcile inalterado.

---

## 8. Limitações

- Echo heal de PENDING não roda no reconcile (sem echo payload).  
- FollowUp suspeito não força `FAILED` (lazy timeout / Ops manual ainda disponíveis).  
- Contadores `reconcile.*` são in-process.  
- AI / Outbound workers **não** iniciados.

---

## 9. Veredito

**7.2B entregue** atrás de flag. Aguardando aprovação.
