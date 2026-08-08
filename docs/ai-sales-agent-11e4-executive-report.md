# Fase 11E.4 — Next Best Action — Relatório Executivo

**Status:** Concluído — **PARAR** (não iniciar 11E.5)  
**Branch:** `cursor/ai-sales-agent-11e4-dd93`  
**Data:** 2026-08-08

---

## Resumo

O agente agora **decide a próxima ação comercial** após cada mensagem inbound (orçamento, cidade, objeção, fechamento, recovery, escalação ou espera). A decisão é persistida na Sales Memory, exposta em dashboard/UI somente leitura, e usada apenas para **enriquecer** respostas ASSIST/AUTO — sem executar ações sozinho.

---

## Serviços criados

| Serviço | Papel |
|---------|--------|
| `NextBestActionService` | Decisão determinística, persistência, enrich, dashboard |
| `NextBestActionController` | HTTP dashboard + conversation + lead |

---

## Integrações

| Integração | Como |
|------------|------|
| Sales Memory | `nextBestAction`, `lastActionDecisionAt` |
| Lead Scoring | temperature / score |
| Objection Engine | lastObjection prioriza HANDLE / OFFER_ALTERNATIVE / ESCALATE |
| Recovery | pending AI_RECOVERY + silêncio ≥ 3d → SCHEDULE_RECOVERY |
| Lead status | LOST/CONVERTED → WAIT |
| Assist Pipeline | decide → enrich body → metadata.nba (sem mudar regras AUTO) |
| Web UI | card na conversa e no Lead Workspace |

---

## Dashboards

- Backend: `GET /api/ai/nba/dashboard` — top ações, conversões, HOT/WARM/COLD por ação  
- Produto: card “Próxima ação recomendada” (read-only)

---

## Auditorias

- `NBA_DECIDED`
- `NBA_CHANGED`
- `NBA_EXECUTED` (enrich da resposta)

---

## Métricas Prometheus

- `nba_decided_total{action}`
- `nba_changed_total{action}`
- `nba_executed_total{action}`

---

## Cobertura / Build / Lint

| Check | Resultado |
|-------|-----------|
| Unit (NBA + objection + memory + scoring + pipeline) | ✅ 64 |
| E2E `ai-sales-agent-11e4` | ✅ 3 |
| `nest build` | ✅ |
| lint API | ✅ 0 errors |
| web `typecheck` | ✅ |

---

## O que não foi feito

- 11E.5 Purchase Intent  
- Auto-execução de recovery / pause / close  
- UI de edição da NBA  

**Próximo passo só sob nova aprovação: 11E.5.**
