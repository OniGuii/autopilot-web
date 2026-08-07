# Fase 11A — AI Sales Agent Review

**Status:** Implementado  
**Branch:** `cursor/ai-sales-agent-11a-dd93`  
**Design:** `docs/ai-sales-agent-mvp-design.md`  
**Data:** 2026-08-07

---

## Objetivo

Infraestrutura mínima do **agente comercial supervisionado**: Knowledge Base, AI Settings, classificador de intents, regras de escalonamento, auditoria e UI admin — **sem** AUTO envio e **sem** recovery automático.

---

## Entregue

| Item | Status |
|------|--------|
| Persistência KB (FAQ, PRODUCT, PRICE, PAYMENT, DELIVERY, HOURS, ADDRESS) | ✅ |
| Multi-tenant + soft-delete + RLS | ✅ |
| CRUD `/api/knowledge-base` | ✅ |
| AI Settings `OFF` / `ASSIST` / `AUTO` (default ASSIST) | ✅ |
| `GET/PATCH /api/ai/settings` | ✅ |
| `AiIntentService` + intents fechados | ✅ |
| Escalonamento COMPLAINT / HUMAN / UNKNOWN / PRICE sem KB | ✅ |
| Audits `AI_INTENT_CLASSIFIED`, `AI_ESCALATED`, `AI_KB_MATCHED` (+ KB/settings) | ✅ |
| Métricas Prometheus `ai_classifications_total`, `ai_escalations_total`, `ai_kb_matches_total` | ✅ |
| UI `/ai/settings`, `/ai/knowledge-base` (OWNER/ADMIN) | ✅ |
| Migration `20260807200000_ai_sales_agent_11a` | ✅ |
| Testes unitários intents / KB / settings | ✅ |

---

## Fora do escopo (não iniciado)

- **11B+** refinamentos de classifier LLM  
- **11C** Auto Reply / envio WhatsApp pelo agente  
- **11D** Recovery campaigns  
- **11E** ROI Dashboard  
- Alteração do pipeline inbound WhatsApp  
- Qualquer send automático  

`autoEnabled` na API sempre retorna `false` nesta fase, mesmo se `mode=AUTO` estiver salvo.

---

## API

| Método | Path | Roles |
|--------|------|-------|
| GET | `/api/ai/settings` | OWNER, ADMIN |
| PATCH | `/api/ai/settings` | OWNER, ADMIN |
| POST | `/api/ai/classify` | OWNER, ADMIN, AGENT |
| GET/POST | `/api/knowledge-base` | OWNER, ADMIN |
| GET/PATCH/DELETE | `/api/knowledge-base/:id` | OWNER, ADMIN |

Suggest existente (`POST /api/ai/conversations/:id/suggest`) **intacto**.

---

## Schema

- Enums: `AiAgentMode`, `KnowledgeBaseKind`, `AiIntent`  
- Models: `CompanyAiSettings` (1:1), `KnowledgeBaseEntry`  
- RLS `tenant_isolation` nas duas tabelas  
- Extensões Prisma: tenant + soft-delete  

---

## Frontend

- Menu admin: **Agente de IA**, **Base de conhecimento**  
- `RequireRole` OWNER/ADMIN  
- AUTO aparece com label “em breve”; não dispara envio  

---

## Como validar

```bash
cd apps/api && npx prisma migrate deploy && npm test -- --testPathPattern='ai-intent|knowledge-base|ai-settings' --runInBand
cd apps/web && npm run typecheck
```

1. Login OWNER → `/ai/settings` (default ASSIST)  
2. Criar entradas KB (PRICE, FAQ, HOURS…)  
3. `POST /api/ai/classify` com “quanto custa?” sem PRICE na KB → escalated PRICE_WITHOUT_KB  
4. Com PRICE na KB → kbMatched, sem escalate  
5. “quero atendente” → HUMAN + escalate  
6. AGENT não acessa páginas `/ai/*` no menu  

---

## Arquivos principais

**API:** `prisma/schema.prisma`, migration 11A, `modules/ai/*` (settings, KB, intent), prometheus counters  
**Web:** `app/(app)/ai/**`, `features/ai/*`, `rbac`/`nav`/`app-shell`  

---

## Próximo passo

**Não iniciar 11B automaticamente.** Aguardar aprovação e relatório executivo desta fase.
