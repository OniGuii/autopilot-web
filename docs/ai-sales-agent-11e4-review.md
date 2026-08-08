# Fase 11E.4 — Next Best Action Review

**Status:** Implementado  
**Branch:** `cursor/ai-sales-agent-11e4-dd93`  
**Design:** `docs/ai-sales-agent-11e-design.md` §5 (+ catálogo operacional da fase)  
**Data:** 2026-08-08

---

## Objetivo

Transformar o agente de **reativo** para **orientado por ação**: após cada inbound, decidir a próxima melhor ação comercial (NBA) sem OpenAI adicional e sem alterar regras AUTO de intent (11C).

---

## Entregue

| Item | Status |
|------|--------|
| `NextBestActionService` | ✅ |
| Catálogo ASK_*/HANDLE_*/OFFER_*/SCHEDULE_RECOVERY/ESCALATE_HUMAN/WAIT | ✅ |
| Persistência `nextBestAction` + `lastActionDecisionAt` | ✅ |
| Pipeline pós Objection (enrich reply only) | ✅ |
| Dashboard `GET /api/ai/nba/dashboard` | ✅ |
| Read APIs conversation/lead | ✅ |
| UI card “Próxima ação recomendada” | ✅ |
| Audits `NBA_*` | ✅ |
| Prometheus `nba_*_total` | ✅ |
| Testes + docs | ✅ |

---

## Fora do escopo

- **11E.5** Purchase Intent  
- Executar ações automaticamente (schedule recovery, pause, etc.)  
- Alterar allowlist AUTO por intent  

---

## Regras (prioridade)

1. Lead LOST / CONVERTED → `WAIT`  
2. AUTHORITY / NEED → `ESCALATE_HUMAN`  
3. PRICE → `OFFER_ALTERNATIVE`  
4. Outra objeção → `HANDLE_OBJECTION`  
5. HOT + produto + pagamento + entrega → `OFFER_CLOSE`  
6. Sem budget → `ASK_BUDGET`  
7. Sem city → `ASK_CITY`  
8. Sem produto → `ASK_PRODUCT`  
9. Sem pagamento → `ASK_PAYMENT`  
10. Silêncio ≥ 3 dias → `SCHEDULE_RECOVERY`  
11. Else → `WAIT`

---

## ASSIST / AUTO

| Mode | Comportamento |
|------|----------------|
| ASSIST | Persiste NBA; enriquece corpo SUGGESTED; mostra card |
| AUTO | Usa NBA **só** para enriquecer resposta; **não** executa ações |

`NBA_EXECUTED` = enriquecimento aplicado à resposta (não = execução comercial).

---

## APIs

| Método | Path | Roles |
|--------|------|-------|
| GET | `/api/ai/nba/dashboard` | OWNER/ADMIN |
| GET | `/api/ai/nba/conversation/:id` | OWNER/ADMIN/AGENT |
| GET | `/api/ai/nba/lead/:id` | OWNER/ADMIN/AGENT |

---

## UI

- Conversa: card acima da sugestão IA  
- Lead Workspace: card na coluna direita (somente leitura)

---

## Critérios

| Critério | Resultado |
|----------|-----------|
| HOT → OFFER_CLOSE | ✅ |
| Sem orçamento → ASK_BUDGET | ✅ |
| Sem cidade → ASK_CITY | ✅ |
| Objeção → HANDLE_OBJECTION | ✅ |
| AUTHORITY → ESCALATE_HUMAN | ✅ |
| Lead perdido → WAIT | ✅ |
| Multi-tenant | ✅ |
| Build / lint / testes | ✅ |
