# Relatório Executivo — Fase 11C (AI Sales Agent)

**Data:** 2026-08-07  
**Branch:** `cursor/ai-sales-agent-11c-dd93`  
**Status:** Concluída — **não iniciar 11D** sem nova aprovação

---

## 1. O que foi entregue

AUTO supervisionado: a empresa pode optar por respostas automáticas **somente** quando a Knowledge Base cobre a pergunta e os guardrails passam.

| Capacidade | Resultado |
|------------|-----------|
| Modo AUTO opt-in | Default continua ASSIST |
| Auto-reply seguro | PRICE / PRODUCT / PAYMENT / DELIVERY / HOURS / ADDRESS + hit KB |
| Bloqueios duros | COMPLAINT / HUMAN / UNKNOWN nunca enviam sozinhos |
| Guardrails | Limite/conversa, rate/company, cooldown/lead, anti-loop |
| Observabilidade | Audits, Prometheus, Dashboard IA |
| Humano no loop | Sem KB ou guardrail → FollowUp SUGGESTED |

---

## 2. O que propositalmente NÃO foi feito

- ❌ Recovery automático (11D)  
- ❌ ROI financeiro completo / ledger OpenAI (11E)  
- ❌ Multi-agentes / fluxos longos  
- ❌ Vector RAG  

---

## 3. Como o cliente usa

1. Preenche a Base de conhecimento.  
2. Em **Agente de IA**, muda para **Automático (opt-in)** só quando estiver confortável.  
3. Mensagens simples (preço, horário, endereço…) podem ser respondidas sozinhas.  
4. Reclamações e pedidos de humano **sempre** vão para a fila.  
5. Acompanha volume no **Dashboard IA**.  
6. Kill switch: voltar para ASSIST ou OFF.

---

## 4. Impacto técnico

| Área | Mudança |
|------|---------|
| Schema | `AiIntent` +HOURS/ADDRESS; `Conversation.agentPaused` |
| Pipeline | AUTO send via `WhatsappSendService` |
| Message | `senderType=AI_AGENT`, `metadata.source=ai_agent` |
| API | `GET /api/ai/dashboard` |
| Web | `/ai/dashboard` + copy Settings atualizada |

**Risco:** médio — AUTO envia WhatsApp de verdade; mitigado por opt-in, KB grounding e guardrails fail-closed.

---

## 5. Próximo passo

Só avançar para **11D (Recovery)** após AUTO estável em piloto (design: ~5 dias úteis sem incidente grave) e KB madura.
