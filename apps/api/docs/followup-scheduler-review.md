# Fase 7.2A — FollowUp Scheduler Worker Review

**Status:** Implementado  
**Escopo:** automatizar FollowUps `SCHEDULED` vencidos via BullMQ  
**Fora de escopo:** AI Worker, Send Worker, Reconcile Worker, frontend, mudança de APIs públicas

---

## 1. Resumo

Quando `ASYNC_FOLLOWUP_ENABLED=true`, um scanner periódico enfileira FollowUps due na fila `followup-scheduler`. O `FollowUpSchedulerProcessor` reutiliza o fluxo de execute existente (`claim SCHEDULED→EXECUTING` + `WhatsappSendService`).

Com a flag **false** (default), o comportamento atual permanece: execute/retry apenas via HTTP.

---

## 2. Componentes

| Artefato | Papel |
|---|---|
| `QUEUE_FOLLOWUP_SCHEDULER` (`followup-scheduler`) | Fila BullMQ |
| `FollowUpSchedulerProducer` | Enqueue com `jobId=followup:sched:{followUpId}` |
| `FollowUpDueScanner` | Poll due + Redis lock (anti double-scan) |
| `FollowUpSchedulerProcessor` | Worker / claim / execute |
| `FollowUpService.executeDue` | Entrada worker (não altera APIs HTTP) |

---

## 3. Fluxo

```text
Scanner (flag ON):
  SCHEDULED AND scheduledAt <= now
  → enqueue followup-scheduler

Worker:
  validate tenant (companyId + followUpId)
  skip se terminal (EXECUTED/…)
  skip se não due / claim perdido
  assert WhatsApp CONNECTED (pré-claim)
  claim atômico SCHEDULED → EXECUTING
  WhatsappSendService.send
  → EXECUTED | FAILED
```

---

## 4. Proteções

| Proteção | Implementação |
|---|---|
| Sem execução dupla | `jobId` estável + claim `updateMany` |
| Claim falha | outcome `skipped_claim` — job completa |
| EXECUTED não regride | skip terminal |
| Retries só transitórios | `UnrecoverableError` para 404/validation/disconnected |
| CB OPEN | `ServiceUnavailableException` — retry Bull permitido |
| Pós-claim FAILED | job completa (sem re-tentar attempt de negócio) |

---

## 5. Métricas Ops (`queues.followupScheduler`)

- `waiting`
- `active`
- `completed`
- `failed`

---

## 6. Alertas novos

| Código | Condição |
|---|---|
| `FOLLOWUP_BACKLOG_HIGH` | `followupScheduler.waiting >= FOLLOWUP_SCHEDULER_BACKLOG_HIGH` |
| `FOLLOWUP_STUCK_EXECUTING` | FollowUps `EXECUTING` stale (>5m) |

Mantido: `EXECUTING_FOLLOWUPS_STALE` (compat).

---

## 7. Flags / env

| Var | Default |
|---|---|
| `ASYNC_FOLLOWUP_ENABLED` | `false` |
| `FOLLOWUP_SCHEDULER_ATTEMPTS` | `3` |
| `FOLLOWUP_SCHEDULER_BACKOFF_MS` | `5000` |
| `FOLLOWUP_SCHEDULER_CONCURRENCY` | `5` |
| `FOLLOWUP_SCHEDULER_SCAN_INTERVAL_MS` | `30000` |
| `FOLLOWUP_SCHEDULER_SCAN_BATCH` | `50` |
| `FOLLOWUP_SCHEDULER_BACKLOG_HIGH` | `100` |

---

## 8. Rollback

1. `ASYNC_FOLLOWUP_ENABLED=false` → scanner para; HTTP execute inalterado.  
2. Workers podem drenar jobs residuais.  
3. Sem migration de schema nesta fase.

---

## 9. Limitações

- Actor de send/audit = `approvedBy` / `assignedUserId` / OWNER (FK-safe).  
- Contadores de retries/stalled continuam in-process (shared com inbound).  
- Sem DLQ dedicada para followup-scheduler (retenção `removeOnFail` da fila).  
- AI / Send / Reconcile workers **não** iniciados.

---

## 10. Veredito

**7.2A entregue** atrás de flag. Pronto para revisão/aprovação antes de enablement em staging.
