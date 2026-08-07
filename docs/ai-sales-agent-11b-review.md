# Fase 11B — AI Sales Agent Review

**Status:** Implementado  
**Branch:** `cursor/ai-sales-agent-11b-dd93`  
**Design:** `docs/ai-sales-agent-mvp-design.md`  
**Data:** 2026-08-07

---

## Objetivo

Transformar a IA em **assistente operacional real** nas conversas WhatsApp, mantendo **humano no loop**: classificar intent no inbound, buscar Knowledge Base, gerar FollowUp `AI_REPLY` `SUGGESTED` — **sem** auto-send.

---

## Entregue

| Item | Status |
|------|--------|
| Pipeline pós-inbound (`AiAssistPipelineService`) | ✅ |
| Classificação via `AiIntentService` + persistência (message metadata + audit) | ✅ |
| `KnowledgeBaseResolver` (matching simples, sem embeddings) | ✅ |
| Modo ASSIST: gera FollowUp `AI_REPLY` `SUGGESTED` | ✅ |
| Escalonamento COMPLAINT / HUMAN / UNKNOWN | ✅ |
| Escalonamento PRICE/PRODUCT/PAYMENT/DELIVERY sem KB | ✅ |
| Flag `requiresHuman` + `autoSend: false` no metadata | ✅ |
| Audits `AI_INTENT_CLASSIFIED`, `AI_RESPONSE_GENERATED`, `AI_ESCALATED`, `AI_KB_MATCH_FOUND`, `AI_KB_MATCH_MISSED` | ✅ |
| Métricas Prometheus 11B (`ai_intent_*`, `ai_response_*`, `ai_kb_hit/miss`) | ✅ |
| Diagnostics: modo, KB count, hit rate, escalation rate | ✅ |
| UI Conversation Detail — card “Resposta sugerida pela IA” | ✅ |
| Aprovar / Editar / Rejeitar reutilizando FollowUp | ✅ |
| Testes unitários (PRICE±KB, PRODUCT, COMPLAINT, HUMAN, UNKNOWN, OFF, AUTO→ASSIST) | ✅ |

---

## Fora do escopo (não iniciado)

- **11C** Auto Reply / envio WhatsApp pelo agente  
- **11D** Recovery campaigns  
- **11E** ROI Dashboard  
- Embeddings / vector DB  
- Qualquer AUTO SEND  

Modo `AUTO` na settings continua **degradado para ASSIST** (cria sugestão, não envia).

---

## Fluxo

```text
Inbound WhatsApp (persistido)
  → se mode == OFF → stop
  → AiIntentService.classify
  → KnowledgeBaseResolver.resolve
  → evaluateEscalation (requiresHuman?)
  → gera texto (template KB / handoff)
  → FollowUp AI_REPLY SUGGESTED
  → audits + métricas
  → NUNCA WhatsApp send
```

Webhook permanece rápido: pipeline é fire-and-forget após `PROCESSED`.

---

## API / UI

- Sem endpoint novo obrigatório — reusa FollowUp approve/reject/update.  
- `GET /api/conversations/:id` passa a incluir `aiSuggestion` (último `AI_REPLY` `SUGGESTED`).  
- `GET /api/ops/diagnostics` inclui bloco `aiAgent`.  
- Conversation Detail: card com Intent, Confiança, Fonte KB, texto + botões.

---

## Como validar

1. OWNER preenche KB (PRICE/PRODUCT) e modo ASSIST.  
2. Enviar inbound WhatsApp com “quanto custa…”.  
3. Abrir conversa → card de sugestão IA.  
4. Aprovar / editar / rejeitar via FollowUp.  
5. Inbound “quero reclamar” / “atendente” → `requiresHuman=true`, audit `AI_ESCALATED`.  
6. Confirmar que **nenhuma** mensagem WhatsApp saiu sem ação humana.  
7. `/metrics` expõe `ai_intent_*`, `ai_response_generated`, `ai_kb_hit`, `ai_kb_miss`.  
8. Diagnósticos mostram modo + taxas.

---

## Critérios de aceite

| Critério | Resultado |
|----------|-----------|
| inbound classifica intent | ✅ |
| KB responde quando existir | ✅ |
| FollowUp AI_REPLY criado automaticamente | ✅ |
| complaint sempre escala | ✅ |
| human sempre escala | ✅ |
| nenhum auto-send | ✅ |
| auditoria completa | ✅ |
| métricas expostas | ✅ |
| build / lint / testes | ✅ (validar na CI local) |

**Não iniciar 11C** sem nova aprovação.
