# Runbook — Redis

**Usos:** BullMQ queues, auth access cache, rate limits / locks (AI), throttling  
**Health:** `/health/ready` inclui Redis ping; diagnostics `checks.redis`

---

## Checks rápidos

```bash
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping
curl -sS "$API/health/ready"
curl -sS "$API/api/ops/diagnostics" -H "Authorization: Bearer $TOKEN"
```

Config: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`.

---

## Incidentes

### Redis offline
**Sintomas:** ready 503; queues.available=false; diagnostics redis error; possível falha de cache auth  
**Ações:**
1. Subir Redis / corrigir rede/ACL
2. Validar `PING`
3. Restart API/workers após Redis estável (reconectar Bull)
4. Esperar reprocessamento de jobs — **não** flush sem necessidade

### Flush acidental
1. Filas vazias → perda de jobs async
2. Reconcile + redrive a partir de DB (messages/follow-ups/webhooks)
3. Revisar backups/AOF/RDB

### Latência alta Redis
1. Slowlog / memória / eviction
2. Isolar Bull vs cache se possível (fase futura)
3. Reduzir carga de workers

### Cache auth stale
- Keys `autopilot:auth:access:*`
- Revogação chama invalidação; se Redis down, fail-closed pode negar acesso até recovery

---

## Incident response — Redis offline

| Passo | Ação |
|---|---|
| 1 | Tratar como outage de async + possível auth cache |
| 2 | Priorizar restore Redis (dados persistidos) |
| 3 | Validar ready + diagnostics |
| 4 | Smoke login + 1 job outbound/inbound |
| 5 | Checar DLQ/backlog residual |
