# Relatório Executivo — Fase 11B (AI Sales Agent)

**Data:** 2026-08-07  
**Branch:** `cursor/ai-sales-agent-11b-dd93`  
**Status:** Concluída — **não iniciar 11C** sem nova aprovação

---

## 1. O que foi entregue

A Fase 11B coloca o agente **dentro das conversas**, ainda sob supervisão humana.

| Capacidade | Resultado |
|------------|-----------|
| Classificação automática no inbound | 7 intents + persistência/audit |
| Busca na Knowledge Base | Matching simples por palavras (sem vector DB) |
| Sugestão operacional (ASSIST) | FollowUp `AI_REPLY` `SUGGESTED` na conversa |
| Escalonamento | Reclamação, pedido de humano, desconhecido e intents sem KB |
| UI na conversa | Card “Resposta sugerida pela IA” com aprovar/editar/rejeitar |
| Observabilidade | Métricas Prometheus + bloco no Diagnósticos |
| Segurança de produto | **Zero** auto-send WhatsApp |

---

## 2. O que propositalmente NÃO foi feito

- ❌ Envio automático (mesmo com mode=`AUTO`)  
- ❌ Recovery automático (11D)  
- ❌ Dashboard de ROI (11E)  
- ❌ Orquestrador AUTO com guardrails de send (11C)  
- ❌ Embeddings / RAG vetorial  

O humano continua no loop: a IA só sugere; aprovação/rejeição usa o fluxo de FollowUp já existente.

---

## 3. Como o cliente usa a partir de agora

1. Manter KB preenchida (preços, produtos, pagamento, entrega, FAQ).  
2. Modo **ASSIST** (default) ou **OFF**.  
3. Mensagens WhatsApp inbound geram sugestão na conversa.  
4. Operador abre a conversa → vê intent, confiança, fonte KB e texto.  
5. **Aprovar** (agenda FollowUp), **Editar** o texto, ou **Rejeitar**.  
6. Envio WhatsApp continua sendo ação humana / execute do FollowUp — nunca automático nesta fase.

---

## 4. Impacto técnico

| Área | Mudança |
|------|---------|
| WhatsApp inbound | Hook pós-persistência → `AiAssistPipelineService` (async, não bloqueia webhook) |
| AI module | `KnowledgeBaseResolver` + pipeline ASSIST |
| Conversations API | Campo `aiSuggestion` no detalhe |
| Ops diagnostics | Bloco `aiAgent` (modo, KB, hit/escalation rate) |
| Prometheus | Contadores `ai_intent_*`, `ai_response_*`, `ai_kb_hit/miss` |
| Web | Card na Conversation Detail + painel no Diagnósticos |

**Risco de regressão:** baixo — outbound WhatsApp intacto; pipeline engole erros para não falhar webhook.

---

## 5. Próximo passo recomendado

Só avançar para **11C (Auto Reply)** depois de:

1. Piloto com KB mínima estável.  
2. Amostra humana validando intents (≥70% agreement, conforme design).  
3. Aprovação explícita de AUTO opt-in + kill switch.

Até lá, o valor já está em produção: **menos tempo digitando**, **mais contexto**, **humano decide o envio**.
