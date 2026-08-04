# Fase 7.2C — AI Worker Review

**Status:** Implementado  
**Escopo:** assincronizar geração de sugestões IA via BullMQ  
**Fora de escopo:** Outbound/Send Worker, Fase 8, frontend, mudanças de domínio

---

## 1. Resumo

Com `ASYNC_AI_ENABLED=false` (default): `POST /api/ai/conversations/:id/suggest` permanece **100% sync** (lock Redis → OpenAI → FollowUp `AI_REPLY` → audit).

Com `ASYNC_AI_ENABLED=true`:

1. Valida conversation (tenant / OPEN|IDLE) + rate limits  
2. Cria solicitação (payload + `correlationId`)  
3. Enfileira em `ai-suggestions`  
4. Retorna `{ ok, accepted, conversationId, correlationId, jobId }`

O `AiSuggestionProcessor` chama `AiService.processSuggestJob` (sempre sync), que reutiliza o fluxo atual: contexto → OpenAI → FollowUp `AI_REPLY` SUGGESTED → `AI_SUGGESTION_GENERATED` → métricas.

---

## 2. Componentes

| Artefato | Papel |
|---|---|
| `ai-suggestions` | Fila BullMQ |
| `AiSuggestionProducer` | Enqueue (`jobId=ai:suggest:{companyId}:{conversationId}`) |
| `AiSuggestionProcessor` | Worker |
| `AiService.acceptSuggestRequest` | Path HTTP async |
| `AiService.processSuggestJob` | Path worker (sync generation) |

---

## 3. Proteções

| Regra | Como |
|---|---|
| Lock Redis por conversation | Mantido em `runSuggest` (worker) |
| Sem sugestões concorrentes | `jobId` estável + dedupe → 409; gen-lock Redis |
| Timeout configurável | `AI_SUGGEST_TIMEOUT_MS` (OpenAI) + `AI_SUGGEST_LOCK_DURATION_MS` (Bull) |
| Retries só transitórios | `ServiceUnavailableException` (OpenAI) retenta |
| Sem retry | quota 429, validação 400, 404, conflict 409, prompt inválido |

---

## 4. Métricas (`GET /api/ops/metrics` → `queues`)

```json
{
  "aiSuggestions": { "waiting": 0, "active": 0, "completed": 0, "failed": 0 },
  "ai": {
    "generated": 1,
    "failed": 0,
    "avgDuration": 842
  }
}
```

---

## 5. Alertas

| Código | Condição |
|---|---|
| `AI_QUEUE_BACKLOG_HIGH` | `aiSuggestions.waiting >= AI_SUGGEST_BACKLOG_HIGH` (default 50) |
| `AI_GENERATION_FAILURE_RATE` | `(failed/(generated+failed)) >= threshold` com min samples |

---

## 6. Flags / env

| Var | Default |
|---|---|
| `ASYNC_AI_ENABLED` | `false` |
| `AI_SUGGEST_ATTEMPTS` | `3` |
| `AI_SUGGEST_BACKOFF_MS` | `3000` |
| `AI_SUGGEST_CONCURRENCY` | `2` |
| `AI_SUGGEST_TIMEOUT_MS` | `25000` |
| `AI_SUGGEST_LOCK_DURATION_MS` | `90000` |
| `AI_SUGGEST_BACKLOG_HIGH` | `50` |
| `AI_FAILURE_RATE_MIN_SAMPLES` | `10` |
| `AI_FAILURE_RATE_THRESHOLD` | `0.5` |

---

## 7. Rollback

`ASYNC_AI_ENABLED=false` → suggest volta ao sync; fila/worker ociosos.

---

## 8. Limitações

- Contadores `ai.*` são in-process (por processo worker/API).  
- Cliente async deve poll FollowUps / UI existente para obter a sugestão.  
- Outbound Worker **não** iniciado.

---

## 9. Veredito

**7.2C entregue** atrás de flag. Aguardando aprovação.
