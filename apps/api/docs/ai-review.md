# AI Assist MVP — Review (Fase 5)

**Status:** Implementação entregue  
**Fase:** 5 — AI Assist MVP  
**Branch:** `cursor/ai-implementation-dd93`  
**Base de design:** `ai-design.md` + ajustes obrigatórios aprovados  

---

## 1. Escopo entregue

| Item | Status |
|---|---|
| `POST /api/ai/conversations/:conversationId/suggest` | ✅ |
| Persistência via FollowUp existente (`SUGGESTED`) | ✅ |
| `type = AI_REPLY` | ✅ |
| Lock lógico: 1 geração simultânea por Conversation | ✅ |
| Prompt centralizado em `src/modules/ai/prompts/` | ✅ |
| Contexto: últimas 20 msgs / máx. 8000 chars | ✅ |
| Auditorias `AI_SUGGESTION_GENERATED` / `_APPROVED` / `_REJECTED` | ✅ |
| Rate limit company: 10/min e 200/dia | ✅ |
| Sem migrations / sem alteração de schema | ✅ |
| Sem auto-send / auto-gen / RAG / embeddings / agentes / classificação / Lead status | ✅ |

---

## 2. Fluxo

```text
POST /api/ai/conversations/:id/suggest  (JWT.cid, OWNER|ADMIN|AGENT)
  → valida Conversation OPEN|IDLE + tenant
  → lock em memória (companyId:conversationId)
  → rate limit (count FollowUp metadata.source=ai)
  → últimas 20 Messages (trim 1000/msg, budget 8000)
  → OpenAiClient.chatCompletion
  → CREATE FollowUp SUGGESTED type=AI_REPLY + metadata.source=ai
  → Audit AI_SUGGESTION_GENERATED
  → humano: approve / reject / edit (FollowUp existente)
       approve → FOLLOWUP_APPROVE + AI_SUGGESTION_APPROVED
       reject  → FOLLOWUP_REJECT  + AI_SUGGESTION_REJECTED
  → execute → WhatsApp (Fase 4; sem mudança de contrato)
```

A IA **nunca** envia mensagem sozinha.

---

## 3. Arquivos principais

| Path | Papel |
|---|---|
| `src/modules/ai/ai.controller.ts` | Endpoint autenticado |
| `src/modules/ai/ai.service.ts` | Orquestração, lock, rate limit, contexto |
| `src/modules/ai/openai.client.ts` | Adapter HTTP Chat Completions |
| `src/modules/ai/prompts/suggest-reply.prompt.ts` | System + user prompt pt-BR |
| `src/modules/ai/ai.constants.ts` | Limites, audits, helpers |
| `src/modules/follow-up/follow-up.service.ts` | Audits AI em approve/reject |
| `src/modules/ai/ai.service.spec.ts` | Testes unitários AI |
| `src/modules/follow-up/follow-up.service.spec.ts` | Testes approve/reject AI |

---

## 4. Persistência (sem schema novo)

Sugestão = `FollowUp`:

- `status`: `SUGGESTED`
- `type`: `AI_REPLY`
- `channel`: `WHATSAPP`
- `suggestedBody`: texto gerado
- `assignedUserId`: `JWT.sub`
- `metadata`: `{ source: "ai", model, promptVersion, promptTokens, completionTokens, totalTokens, generatedAt, tone, instruction?, attemptCount }`

---

## 5. Limites

| Controle | Valor |
|---|---|
| Mensagens no contexto | 20 |
| Budget total de contexto | 8000 chars |
| Truncate por mensagem | 1000 chars |
| `suggestedBody` | ≤ 4096 |
| `instruction` | ≤ 500 |
| Rate / minuto / company | 10 → HTTP 429 |
| Rate / dia UTC / company | 200 → HTTP 429 |
| Concurrent suggest / conversation | 1 (lock em memória) |
| `max_tokens` / temperature | 400 / 0.4 |

---

## 6. OpenAI

- Env: `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o-mini`)
- Sem key em runtime → **503**
- `NODE_ENV=test` sem key → stub determinístico
- Timeout 25s

---

## 7. Multi-tenancy

- Tenant exclusivo via `JWT.cid`
- Conversation / Lead / Message / FollowUp sempre filtrados por `companyId`
- Cross-tenant → 404
- Contagem de rate limit por `companyId`

---

## 8. Fora deste MVP (explícito)

- Auto-send / geração automática no inbound  
- RAG / embeddings / agentes  
- Classificação automática  
- Alteração de `Lead.status` pela IA  
- Migrations / tabelas novas  
- Frontend dedicado  
- Streaming SSE  

---

## 9. Testes cobertos

- Geração + FollowUp `AI_REPLY` + audit `AI_SUGGESTION_GENERATED`
- Cross-tenant 404
- Conversation CLOSED → 400
- Lock concorrente → 409
- Rate limit minuto/dia → 429
- OpenAI 503
- Contexto vazio → 400
- Approve/reject AI → audits adicionais

---

## 10. Critérios de aceite

- [x] Endpoint autenticado com tenant  
- [x] FollowUp SUGGESTED sem migration  
- [x] Metadata `source=ai`  
- [x] Audits GENERATED / APPROVED / REJECTED  
- [x] Rate limit + lock  
- [x] Sem envio automático  
- [x] `docs/ai-review.md`  
- [x] Testes unitários  

---

## 11. Próximo passo

**Aguardar aprovação explícita** antes de qualquer nova fase (5.1+).
