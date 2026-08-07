# Fase 11D — Relatório Executivo (Recovery Engine)

**Status:** Implementado (pré-validação de build/testes no CI/local)  
**Branch:** `cursor/ai-sales-agent-11d-dd93`  
**Data:** 2026-08-07

---

## Resumo

O Recovery Engine agenda e envia follow-ups de recuperação (`AI_RECOVERY`) sobre a infraestrutura existente (FollowUp Scheduler, BullMQ, WhatsApp, AI Settings, Audit, Metrics). Políticas por empresa controlam cadência R1/R2/R3, limites e stop conditions. Não há motor de envio paralelo.

---

## Valor de negócio

- Retoma leads CONTACTED/RESPONDED sem resposta, com anti-spam.  
- Respeita reply do cliente e takeover humano.  
- Painel operacional em `/ai/recovery` para OWNER/ADMIN.  
- Auditoria e Prometheus para operação.

---

## Superfície

| Área | Entrega |
|------|---------|
| API | `/api/ai/recovery/settings`, `/api/ai/recovery/dashboard` |
| UI | `/ai/recovery` |
| Dados | `company_recovery_settings` + FollowUp `AI_RECOVERY` |
| Métricas | `ai_recovery_active|sent|stopped|converted|conversion_rate` |
| Audits | `AI_RECOVERY_CREATED|SENT|STOPPED|CONVERTED` |

---

## Riscos mitigados

| Risco | Mitigação |
|-------|-----------|
| Spam / ban | max 3, cooldown, rate/min, horários, pending único |
| Loop | stop on reply + prepareExecution re-check |
| Takeover humano | `agentPaused` + flag stopOnHumanTakeover |
| Tenant leak | companyId em todas as queries + RLS na policy |

---

## Validação

Ver seção de resultados de build/testes ao final desta revisão após execução local/CI.

---

## Próximo (não iniciado)

**11E** — ROI Dashboard (economia, custo OpenAI, segmentação).
