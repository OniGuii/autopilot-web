# Runbook — Workers & Queues

**Processos:** API com workers (`ASYNC_WORKERS_IN_API=true`) e/ou `npm run start:worker`  
**Filas BullMQ:** inbound, followup, reconcile, AI, outbound, DLQ

---

## Checks rápidos

```bash
curl -sS "$API/api/ops/diagnostics" -H "Authorization: Bearer $TOKEN"
curl -sS "$API/api/ops/health" -H "Authorization: Bearer $TOKEN"
curl -sS "$API/api/ops/metrics" -H "Authorization: Bearer $TOKEN"
```

Olhar: `queues.available`, depths waiting/failed, `dlqDepth`, `oldestDlqAgeMs`.

Flags relevantes: `ASYNC_INBOUND_ENABLED`, `ASYNC_AI_ENABLED`, `ASYNC_OUTBOUND_ENABLED`, `ASYNC_WORKERS_IN_API`.

---

## Incidentes

### Worker parado
**Sintomas:** jobs acumulam em waiting; completed não sobe; sync path pode mascarar se flags async=false  
**Ações:**
1. Confirmar processo worker vivo (systemd/docker/pm2)
2. Redis acessível
3. Restart worker; não apagar filas
4. Se API embute workers, restart API

### Queue travada / backlog
1. Identificar fila (inbound / outbound / ai / followup / reconcile)
2. Ver failed + DLQ
3. Inspecionar job payload/logs (correlationId)
4. Corrigir causa (Evolution/OpenAI/bug)
5. Retry seletivo — evitar flood
6. Reconcile Ops (`POST /api/ops/reconcile/*`) só OWNER|ADMIN

### DLQ crescendo
1. Priorizar root cause
2. Replay controlado após fix
3. Alertar se `oldestDlqAgeMs` alto

### Follow-up não executa
1. Status SUGGESTED vs SCHEDULED
2. Scheduler/scanner ativo?
3. WhatsApp CONNECTED?
4. Job followup na fila?

---

## Incident response — Worker parado / Queue travada

| Passo | Ação |
|---|---|
| 1 | Declarar degradação operacional (async off/slow) |
| 2 | Snapshot metrics + DLQ |
| 3 | Resta worker / Redis |
| 4 | Smoke: inbound → outbound → follow-up execute |
| 5 | Registrar incidente + audits relevantes |
