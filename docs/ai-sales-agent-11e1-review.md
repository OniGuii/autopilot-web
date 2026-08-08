# Fase 11E.1 — Sales Memory Review

**Status:** Implementado  
**Branch:** `cursor/ai-sales-agent-11e1-dd93`  
**Design:** `docs/ai-sales-agent-11e-design.md` §2  
**Data:** 2026-08-08

---

## Objetivo

Persistir **memória comercial por Conversation** para o agente lembrar o que já descobriu sobre o lead — sem OpenAI extra, sem alterar comportamento ASSIST/AUTO (11C).

---

## Entregue

| Item | Status |
|------|--------|
| `Conversation.metadata` (JSON) + chave `salesMemory` | ✅ |
| `SalesMemoryService` load/update/merge/clear | ✅ |
| `SalesMemoryExtractorService` (regras) | ✅ |
| Hook pós-classify no `AiAssistPipelineService` | ✅ |
| Recovery 11D usa memória (não reinicia frio) | ✅ |
| Audits `SALES_MEMORY_*` | ✅ |
| Prometheus `sales_memory_*` | ✅ |
| Debug API GET/DELETE `/api/ai/sales-memory/:conversationId` | ✅ |
| Testes unitários + e2e | ✅ |
| Docs review + executive | ✅ |

---

## Fora do escopo (não iniciado)

- **11E.2** Lead Scoring  
- **11E.3** Objection Engine  
- **11E.4** Next Best Action  
- **11E.5** Purchase Intent / Sales Dashboard UI  

---

## Persistência

Sem nova entidade. Migration mínima:

```text
ALTER TABLE conversations ADD COLUMN metadata JSONB;
```

Memória em `Conversation.metadata.salesMemory`:

- budget, productInterest[], city, urgency  
- paymentPreference, deliveryPreference  
- lastObjection, purchaseIntentLevel  
- version, updatedAt, sourceMessageIds[]

Sobrevive a novas mensagens, recovery, restart de API/worker (Postgres).

---

## Fluxo inbound

```text
Inbound
  → classify (11B)
  → SalesMemory.updateFromInbound (best-effort)
  → KB + ASSIST/AUTO (11C inalterado)
```

---

## Recovery

`AiRecoveryMessageService` carrega memória e injeta resumo (“Retomando do que já combinamos…”) antes do bloco KB.

---

## Endpoints

| Método | Path | Role |
|--------|------|------|
| GET | `/api/ai/sales-memory/:conversationId` | OWNER/ADMIN |
| DELETE | `/api/ai/sales-memory/:conversationId` | OWNER/ADMIN |

Sem UI nova.

---

## Critérios de aceite

| Critério | Resultado |
|----------|-----------|
| Memória persistente | ✅ |
| Merge + conflitos | ✅ |
| Multi-tenant (companyId) | ✅ |
| Recovery usa contexto | ✅ |
| 11C intacto | ✅ |
| Build / lint (0 errors) / testes | ✅ (ver executive) |
