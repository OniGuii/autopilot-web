# Runbook — WhatsApp / Evolution

**Serviço:** `/api/whatsapp/*` + webhook `/api/whatsapp/webhook/:instanceKey`  
**Dependência externa:** Evolution API (stub se `EVOLUTION_API_URL` vazio)

---

## Checks rápidos

```bash
# Status da company (JWT com cid)
curl -sS "$API/api/whatsapp/status" -H "Authorization: Bearer $TOKEN"

# Diagnostics
curl -sS "$API/api/ops/diagnostics" -H "Authorization: Bearer $TOKEN"

# Health público
curl -sS "$API/health/ready"
```

Estados: `QR_PENDING` | `CONNECTING` | `CONNECTED` | `DISCONNECTED` | `ERROR`

---

## Incidentes

### Evolution offline
**Sintomas:** connect/send 503/timeout; circuit `OPEN`; diagnostics whatsapp degraded  
**Ações:**
1. Verificar `EVOLUTION_API_URL` / rede / credenciais
2. Ver circuit em `/api/ops/health` (`evolution.circuit`)
3. Aguardar cooldown ou restart Evolution
4. `POST /whatsapp/connect` novamente após recovery
5. Mensagens outbound podem ficar PENDING/FAILED — reconciliar via Ops se necessário

### Webhook inbound não chega
1. URL pública aponta para API? (`/api/whatsapp/webhook/:instanceKey`)
2. Header `X-Webhook-Secret` correto (secret só no connect; seed piloto tem secret conhecido non-prod)
3. InstanceKey UUID válido e row não soft-deleted
4. Logs de `WebhookEvent` em `/api/ops/webhooks`

### Send falha com instance não CONNECTED
1. `GET /whatsapp/status`
2. Reconectar; não forçar send em DISCONNECTED
3. Stub local: URL Evolution vazia + `NODE_ENV` development/test

### Circuit breaker OPEN
1. Reduzir retries / tráfego
2. Corrigir Evolution
3. Circuit fecha após sucesso + cooldown (ver config `evolution.*`)

---

## Incident response — Evolution offline (piloto)

| Passo | Ação |
|---|---|
| 1 | Comunicar equipe: inbound/outbound pausados |
| 2 | Confirmar se stub/dev vs prod Evolution |
| 3 | Não purgar filas às cegas |
| 4 | Após UP: reconnect + smoke send + 1 inbound teste |
| 5 | Auditar failed messages / DLQ |
