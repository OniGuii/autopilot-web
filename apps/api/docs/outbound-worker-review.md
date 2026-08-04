# Fase 8C — Outbound Worker Review

**Status:** Implementado  
**Escopo:** assincronizar envio WhatsApp via BullMQ (`outbound-send`)  
**Fora de escopo:** FollowUp changes, Fase 9, frontend, deploy, mudanças de domínio/APIs públicas (rotas/DTOs)

---

## 1. Resumo

Com `ASYNC_OUTBOUND_ENABLED=false` (default): `POST /api/whatsapp/send` permanece **100% sync** via `WhatsappSendService.send` (PENDING → Evolution → SENT|FAILED → audit).

Com `ASYNC_OUTBOUND_ENABLED=true`:

1. Valida tenant / lead / conversation / instance CONNECTED  
2. Cria Message `PENDING`  
3. Enfileira em `outbound-send` (`jobId=outbound:{messageId}`)  
4. Retorna `{ ok, accepted, messageId, conversationId, leadId, status: PENDING, correlationId, jobId }`

O `OutboundSendProcessor` chama `WhatsappSendService.processOutboundJob`:

1. Claim atômico (`SELECT FOR UPDATE` + `metadata.outboundClaimedAt`)  
2. Evolution `sendText`  
3. SENT ou FAILED + auditoria existente + métricas Prometheus WhatsApp

**FollowUp** continua chamando `send()` **sempre sync** (sem dual-enqueue).

---

## 2. Arquitetura

```text
HTTP POST /whatsapp/send
  → WhatsappSendService.sendHttp
       ├─ flag off → send() [sync]
       └─ flag on  → acceptSend()
              → Message PENDING
              → OutboundSendProducer.enqueue
              → { accepted, jobId }

BullMQ outbound-send
  → OutboundSendProcessor (withBullJobContext → RLS companyId + correlationId)
       → processOutboundJob (claim → Evolution → SENT|FAILED)
```

---

## 3. Componentes

| Artefato | Papel |
|---|---|
| `outbound-send` | Fila BullMQ |
| `OutboundSendProducer` | Enqueue (`jobId=outbound:{messageId}`) |
| `OutboundSendProcessor` | Worker |
| `WhatsappSendService.sendHttp` | Path HTTP (flag) |
| `WhatsappSendService.send` | Sync (FollowUp + flag off) |
| `WhatsappSendService.processOutboundJob` | Path worker |

---

## 4. Proteções

| Regra | Como |
|---|---|
| Idempotência | `jobId` estável por `messageId` + dedupe |
| Sem duplicidade de envio | Claim `FOR UPDATE` + `outboundClaimedAt`; SENT idempotente |
| Sem retry Evolution | `OUTBOUND_SEND_ATTEMPTS=1` + `UnrecoverableError` em falhas de domínio |
| RLS | `withBullJobContext` seta `companyId` ALS → SET LOCAL |
| Correlation / OTEL | payload.correlationId + Bull span + métricas Prisma/HTTP existentes |

---

## 5. Métricas (`GET /api/ops/metrics` → `queues.outbound.*`)

```json
{
  "outbound": {
    "waiting": 0,
    "active": 0,
    "completed": 0,
    "failed": 0,
    "delayed": 0,
    "sent": 1,
    "failures": 0,
    "avgDuration": 320
  }
}
```

Prometheus: gauge `queue_*` label `outbound-send`; job duration histogram por queue.

---

## 6. Alertas

| Código | Condição |
|---|---|
| `OUTBOUND_QUEUE_BACKLOG_HIGH` | `outbound.waiting >= OUTBOUND_QUEUE_BACKLOG_HIGH` (default 100) |
| `OUTBOUND_FAILURE_RATE` | `(failures/(sent+failures)) >= threshold` com min samples |

---

## 7. Flags / env

| Var | Default |
|---|---|
| `ASYNC_OUTBOUND_ENABLED` | `false` |
| `OUTBOUND_SEND_ATTEMPTS` | `1` |
| `OUTBOUND_SEND_BACKOFF_MS` | `3000` |
| `OUTBOUND_SEND_CONCURRENCY` | `5` |
| `OUTBOUND_SEND_LOCK_DURATION_MS` | `45000` |
| `OUTBOUND_QUEUE_BACKLOG_HIGH` | `100` |
| `OUTBOUND_FAILURE_RATE_MIN_SAMPLES` | `10` |
| `OUTBOUND_FAILURE_RATE_THRESHOLD` | `0.5` |

---

## 8. Rollback

`ASYNC_OUTBOUND_ENABLED=false` → send HTTP volta ao sync; fila/worker ociosos.  
FollowUp nunca usou a flag.

---

## 9. Limitações / riscos

- Contadores `outbound.sent/failures` são in-process (por processo worker/API).  
- Cliente async deve poll Message / conversation para SENT|FAILED.  
- Enqueue fail após PENDING → Message marcada FAILED (`ENQUEUE_FAILED`) + 503.  
- Fase 9 / frontend / deploy **não** iniciados.

---

## 10. Veredito

Pronto para revisão. Aguardar aprovação antes de nova fase.
