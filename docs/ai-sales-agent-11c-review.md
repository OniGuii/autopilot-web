# Fase 11C — AI Sales Agent Review

**Status:** Implementado  
**Branch:** `cursor/ai-sales-agent-11c-dd93`  
**Design:** `docs/ai-sales-agent-mvp-design.md`  
**Data:** 2026-08-07

---

## Objetivo

Ativar o modo **AUTO supervisionado**: após inbound, classificar → KB → (se elegível e guardrails OK) enviar via `WhatsappSendService`. Default permanece **ASSIST**. AUTO é opt-in.

---

## Entregue

| Item | Status |
|------|--------|
| AUTO path no `AiAssistPipelineService` | ✅ |
| Send via `WhatsappSendService` (`source=ai_agent`) | ✅ |
| Intents auto-safe: PRICE, PRODUCT, PAYMENT, DELIVERY, HOURS, ADDRESS | ✅ |
| Nunca AUTO: COMPLAINT, HUMAN, UNKNOWN | ✅ |
| Sem KB → FollowUp `AI_REPLY` SUGGESTED + `requiresHuman` | ✅ |
| Persistência Message OUTBOUND + audits + metrics + correlationId | ✅ |
| Guardrails: conv limit, company/min, lead cooldown, anti-loop, confidence, WA connected, agentPaused | ✅ |
| Dashboard IA (`GET /api/ai/dashboard` + UI) | ✅ |
| Migration `20260807210000_ai_sales_agent_11c` (HOURS/ADDRESS + agent_paused) | ✅ |
| Testes unitários + e2e | ✅ |
| Docs review + executive | ✅ |

---

## Fora do escopo

- **11D** Recovery campaigns  
- **11E** ROI completo (custo OpenAI, economia)  
- Agentes multi-etapa  
- RAG / embeddings  

---

## Fluxo AUTO

```text
Inbound processado
  → mode OFF → stop
  → classify + KB resolve
  → COMPLAINT|HUMAN|UNKNOWN → escalate (FollowUp SUGGESTED, pause em COMPLAINT/HUMAN)
  → auto-safe + KB miss → FollowUp SUGGESTED requiresHuman
  → AUTO + KB hit + guardrails OK → WhatsappSendService.send (AI_AGENT)
       + FollowUp EXECUTED + AI_AUTO_SENT
  → AUTO + guardrail fail / send fail → degrade ASSIST (SUGGESTED) + AI_AUTO_SKIPPED
```

---

## Guardrails

| Regra | Constante / fonte |
|-------|-------------------|
| Max AUTO / conversa | `AI_AUTO_MAX_PER_CONVERSATION` (8) |
| Max AUTO / company / min | Redis `AI_AUTO_MAX_PER_COMPANY_PER_MINUTE` (20) |
| Cooldown por lead | `AI_AUTO_LEAD_COOLDOWN_SECONDS` (60) |
| Max AUTO / lead / dia | `CompanyAiSettings.maxAutoRepliesPerLeadDay` |
| Anti-loop | N outbounds `ai_agent` consecutivos |
| Confidence | `>= 0.55` |
| Canal | WhatsApp CONNECTED |
| Pause | `Conversation.agentPaused` |

---

## Como validar

1. Preencher KB (PRICE/HOURS/…).  
2. Settings → modo **AUTO** (`autoEnabled=true`).  
3. Inbound “quanto custa…” → Message OUTBOUND `source=ai_agent` + audit `AI_AUTO_SENT`.  
4. Inbound “quero reclamar” → FollowUp SUGGESTED, sem send, `agentPaused=true`.  
5. Dashboard IA mostra auto / escaladas / taxa.  
6. Voltar para ASSIST — default seguro.

**Não iniciar 11D** sem nova aprovação.
