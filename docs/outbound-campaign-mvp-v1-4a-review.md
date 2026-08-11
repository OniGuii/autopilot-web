# Outbound V1.4A — Campaign MVP Review

**Status:** Implementado  
**Branch:** `cursor/outbound-campaign-mvp-v1-4a-dd93`  
**Design:** `docs/outbound-campaign-engine-v1-4-design.md`  
**Base:** Protection V1.1 · Import V1.2 · First Touch V1.3  
**Data:** 2026-08-11

---

## Objetivo

Criar a **primeira versão operacional de campanhas**: contêiner nomeado com status, membership Lead, attach de import, métricas de funil e geração de First Touch quando RUNNING.

---

## Entregue

| Item | Status |
|------|--------|
| Entidade `OutboundCampaign` (name, description, objective, status) | ✅ |
| Status DRAFT → READY → RUNNING → PAUSED → COMPLETED → ARCHIVED | ✅ |
| Membership `OutboundCampaignLead` (add/remove/count) | ✅ |
| Stamp `Lead.metadata.outboundCampaignId` | ✅ |
| Attach import batch (selecionar todos os leads importados) | ✅ |
| Generate First Touch só se RUNNING | ✅ |
| Dashboard (total / elegíveis / FT enviados / responderam / HOT / convertidos) | ✅ |
| UI `/outbound/campaigns` lista + detalhe | ✅ |
| Audits `CAMPAIGN_*` | ✅ |
| Prometheus `campaigns_total` · `campaign_leads_total` · `campaign_reply_rate` | ✅ |
| Unit + e2e + build | ✅ |
| Review + executive | ✅ |

---

## Fora do escopo (PARAR)

- Campaign Builder avançado  
- A/B test  
- Warm-up  
- Sequências V2 / Campaign Batch diário formal  
- Multi-número  

---

## Fluxo

```text
Lead Import V1.2 (commit)
  → Campaign DRAFT (create)
  → attach-import / add leads
  → READY → RUNNING
  → First Touch generate (membership leads)
  → Protection V1.1 no envio
  → métricas (reply / HOT / convertidos)
  → PAUSE | COMPLETE → ARCHIVE
```

---

## APIs

| Método | Path |
|--------|------|
| GET | `/api/outbound/campaigns/dashboard` |
| GET/POST | `/api/outbound/campaigns` |
| GET/PATCH | `/api/outbound/campaigns/:id` |
| POST | `/api/outbound/campaigns/:id/ready\|start\|pause\|resume\|complete\|archive` |
| GET/POST | `/api/outbound/campaigns/:id/leads` |
| POST | `/api/outbound/campaigns/:id/leads/remove` |
| POST | `/api/outbound/campaigns/:id/attach-import` |
| POST | `/api/outbound/campaigns/:id/first-touch/generate` |

Roles: OWNER / ADMIN.

---

## Dashboard / UI

**Métricas:** total leads · elegíveis · first touch enviados · responderam · HOT (≥70) · convertidos · replyRate  

**Lista** `/outbound/campaigns`: nome · status · leads · resposta · HOT · conversão  

**Detalhe:** informações · leads · métricas · ações de status · attach import · generate D0  

---

## Observabilidade

**Audits:** `CAMPAIGN_CREATED` · `CAMPAIGN_UPDATED` · `CAMPAIGN_STARTED` · `CAMPAIGN_PAUSED` · `CAMPAIGN_COMPLETED` (+ ARCHIVED / LEADS_ADDED / LEADS_REMOVED)

**Prometheus:**  
`campaigns_total` · `campaign_leads_total` · `campaign_reply_rate`

---

## Reuso

| Sistema | Uso |
|---------|-----|
| V1.2 Import | Fonte de segmento via attach-import |
| V1.3 First Touch | Geração D0 a partir dos leads da campanha |
| V1.1 Protection | Gate no send (inalterado) |
| 11E Sales Brain | HOT score ≥70 nas métricas |

---

## PARAR

Não iniciar V2. Não iniciar A/B tests. Não iniciar warm-up. Não iniciar Campaign Batch formal.
