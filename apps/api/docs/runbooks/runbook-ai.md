# Runbook — AI Suggest / OpenAI

**Endpoint:** `POST /api/ai/conversations/:conversationId/suggest`  
**Cliente:** `OpenAiClient` — stub em `NODE_ENV=test` sem key; fora disso sem key → 503  
**Async:** `ASYNC_AI_ENABLED=true` enfileira job; default sync

---

## Checks rápidos

```bash
# Diagnostics (OWNER|ADMIN vê openai)
curl -sS "$API/api/ops/diagnostics" -H "Authorization: Bearer $TOKEN"

# Suggest sync
curl -sS -X POST "$API/api/ai/conversations/$CONV_ID/suggest" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"tone":"professional"}'
```

Env: `OPENAI_API_KEY`, `OPENAI_MODEL`, timeouts async AI.

---

## Incidentes

### OpenAI offline / 5xx / timeout
**Sintomas:** suggest 503; diagnostics openai degraded/error; filas AI failed  
**Ações:**
1. Confirmar status status.openai.com / key / billing
2. Probe diagnostics (timeout 2s)
3. Operar sem AI: follow-ups manuais
4. Se async: drenar/pausar fila ai-suggestions até recovery
5. Não reprocessar em massa sem rate limit

### 429 rate limit / lock 409
1. Esperar janela; reduzir concorrência de suggest
2. Um suggest por conversa (lock) — não martelar

### Stub vs prod confusão
- Piloto real **precisa** de key válida
- Sem key em development → 503 (não stub)
- E2E força `NODE_ENV=test` para stub

### Sugestão ruim / vazia
1. Verificar histórico da conversation (CLOSED → 400)
2. Revisar model/prompt config
3. Agente edita follow-up antes de approve/execute

---

## Incident response — OpenAI offline

| Passo | Ação |
|---|---|
| 1 | Comunicar: AI suggest indisponível; WhatsApp manual OK |
| 2 | Desligar mentalmente dependência de AI no script do piloto |
| 3 | Monitorar fila AI / failed |
| 4 | Após UP: 1 suggest smoke + approve/execute |
| 5 | Registrar no audit (`AI_*` / follow-up actions) |
