# Operations & Observability Design — Fase 4.5

**Status:** Design para aprovação (**sem implementação**)  
**Fase:** 4.5 — Operations & Observability  
**Pré-requisitos:** Auth, Leads, Conversations, Dashboard MVP, WhatsApp Fases 1–4, FollowUp Automation  
**Posição no roadmap:** após WhatsApp/FollowUp reais; **antes da IA (Fase 5)**  
**Restrição:** somente documentação nesta etapa — **sem código**.

---

## 1. Objetivo

Projetar a **camada operacional** do AutoPilot para que OWNER/ADMIN (e, em leitura, AGENT) consigam:

1. Ver saúde do produto e da integração WhatsApp  
2. Diagnosticar falhas de webhook / envio / FollowUp  
3. Reconciliar estados órfãos (PENDING, EXECUTING)  
4. Explorar auditoria e eventos técnicos  
5. Acompanhar métricas de conversão sem depender de IA  

**Fora da Fase 4.5:**
- IA / sugestões automáticas  
- n8n / campanhas  
- APM comercial obrigatório (Datadog etc.) — apenas contrato de métricas  
- BullMQ como requisito (jobs de reconciliação podem ser cron HTTP ou script)  
- Alterar regras de domínio WhatsApp/FollowUp além do necessário para ops  

---

## 2. Arquitetura operacional (visão)

```text
┌─────────────────────────────────────────────────────────────┐
│                    AutoPilot Operations                      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Ops Dashboard│  │ Audit        │  │ Webhook Monitor  │  │
│  │ (UI + APIs)  │  │ Explorer     │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│  ┌──────▼─────────────────▼────────────────────▼─────────┐  │
│  │              Ops Query Services (NestJS)               │  │
│  │  companyId = JWT.cid  ·  roles OWNER|ADMIN|(AGENT RO) │  │
│  └──────┬─────────────────� JWT.cid  ·  roles OWNER|ADMIN|(AGENT RO) │  │
│  └──────┬─────────────────┬──────────────────┬───────────┘  │
│         │                 │                  │              │
│         ▼                 ▼                  ▼              │
│   Dashboard KPIs    AuditLog           WebhookEvent         │
│   Message/FollowUp  Lead/Conversation  WhatsAppInstance     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Reconcile / Health                                    │  │
│  │  GET /health/*  ·  POST /ops/reconcile (admin)        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Princípios:
- **Multi-tenant estrito:** toda leitura ops filtra `companyId = JWT.cid` (exceto health público).  
- **Read-mostly:** Explorer/Monitor não mutam domínio; Reconcile é a única mutação ops controlada.  
- **Reuso:** estender Dashboard MVP; não duplicar KPIs de negócio sem necessidade.  
- **Observabilidade em camadas:** (1) health, (2) product metrics APIs, (3) structured logs, (4) opcional Prometheus depois.

---

## 3. Dashboard operacional

### 3.1 Relação com Dashboard MVP atual

Já existe (`GET /api/dashboard*`):

| Bloco | Métricas |
|---|---|
| Overview | totalLeads, newLeads, convertedLeads, lostLeads, conversionRate |
| Leads | byStatus |
| Conversations | open/closed, messagesSent/Received, avgMessagesPerConversation |
| FollowUps | pending, overdue, executed, executionRate |

**Fase 4.5 acrescenta um painel “Ops”** (não substitui o analytics MVP).

### 3.2 Endpoint proposto

```http
GET /api/ops/dashboard
Authorization: Bearer <access>
```

Roles: **OWNER | ADMIN** (AGENT opcional read-only — **O1**).

### 3.3 Widgets / seções

#### A. WhatsApp Connection
| Campo | Fonte |
|---|---|
| `status` | WhatsAppInstance.status |
| `phoneNumber` | instance |
| `connectedAt` / `lastDisconnectedAt` | instance |
| `lastError` | instance |
| `instanceKey` (parcial) | ops debug |

#### B. Pipeline de mensagens (24h / período)
| Métrica | Definição |
|---|---|
| `outboundSent` | Message OUTBOUND status ∈ {SENT,DELIVERED,READ} |
| `outboundFailed` | OUTBOUND FAILED |
| `outboundPendingStale` | OUTBOUND PENDING ∧ createdAt < now−5m |
| `inboundReceived` | INBOUND RECEIVED |
| `deliveryRate` | DELIVERED+READ / SENT+DELIVERED+READ (evitar div0) |
| `readRate` | READ / DELIVERED+READ |

#### C. FollowUp operacional
| Métrica | Definição |
|---|---|
| `scheduled` | status SCHEDULED |
| `executing` | EXECUTING |
| `executingStale` | EXECUTING ∧ updatedAt < now−5m |
| `failed` | FAILED |
| `executed` | EXECUTED (período) |
| `retryExhausted` | FAILED ∧ metadata.attemptCount ≥ 3 |
| `successRate` | EXECUTED / (EXECUTED+FAILED) no período |

#### D. Webhooks (24h)
| Métrica | Definição |
|---|---|
| `received` | WebhookEvent count |
| `processed` | status PROCESSED |
| `failed` | FAILED |
| `ignored` | IGNORED |
| `duplicate` | DUPLICATE |
| `failureRate` | FAILED / RECEIVED |

#### E. Alertas derivados (boolean / counts)
| Alerta | Condição |
|---|---|
| `whatsappNotConnected` | status ≠ CONNECTED |
| `pendingMessagesStale` | outboundPendingStale > 0 |
| `executingFollowUpsStale` | executingStale > 0 |
| `webhookFailuresSpike` | failureRate > limiar (ex. 10% em 1h) — **O2** |

### 3.4 Query

```text
?from=&to=   // default: últimas 24h para ops; analytics dashboard mantém seu default
```

---

## 4. Health checks avançados

### 4.1 Estado atual

| Path | Hoje |
|---|---|
| `GET /health` | OK estático |
| `GET /health/live` | liveness estático |
| `GET /health/ready` | ready estático (DB/Redis adiados) |

### 4.2 Proposta

| Path | Auth | Comportamento |
|---|---|---|
| `GET /health/live` | Público | Processo up (inalterado) |
| `GET /health/ready` | Público | Probe **Postgres** (`SELECT 1`); Redis opcional se configurado |
| `GET /health` | Público | Agrega live + ready + versão/build |
| `GET /api/ops/health` | JWT OWNER\|ADMIN | Ready + checks de produto (abaixo) |

### 4.3 Checks de produto (`/api/ops/health`)

| Check | Critério | Severidade |
|---|---|---|
| `database` | ping OK | critical |
| `whatsappInstance` | existe instance ativa | warning se ausente |
| `whatsappConnected` | status === CONNECTED | warning |
| `pendingMessagesStale` | count == 0 | warning |
| `executingFollowUpsStale` | count == 0 | warning |
| `webhookFailedRecent` | FAILED últimos 15m == 0 (ou < N) | warning |

Response shape:

```json
{
  "status": "ok" | "degraded" | "error",
  "checks": [
    { "name": "database", "status": "pass", "latencyMs": 3 },
    { "name": "whatsappConnected", "status": "warn", "detail": "DISCONNECTED" }
  ],
  "generatedAt": "..."
}
```

Regras:
- `error` se qualquer check **critical** falhar  
- `degraded` se só warnings  
- `ok` se todos pass  

**Não** expor secrets, hashes ou payload bruto de webhook no health público.

---

## 5. Reconciliação

### 5.1 Problema

Estados órfãos já documentados:
- Message `PENDING` > 5 min (P3-D3) — sem auto-fail hoje  
- FollowUp `EXECUTING` > 5 min (P4-X1) — lazy no find/execute; falta job/ops explícito  

### 5.2 Endpoint proposto

```http
POST /api/ops/reconcile
Authorization: Bearer <access>
Content-Type: application/json

{
  "targets": ["pending_messages", "executing_followups"],
  "dryRun": true
}
```

Roles: **OWNER | ADMIN** apenas.

### 5.3 Ações

| Target | Critério | Ação (dryRun=false) |
|---|---|---|
| `pending_messages` | OUTBOUND PENDING ∧ age > 5m | Marcar FAILED + `errorMessage=PENDING_TIMEOUT` + audit `WHATSAPP_MESSAGE_FAILED` (SYSTEM) — **O3** |
| `executing_followups` | EXECUTING ∧ age > 5m | FAILED + `EXECUTING_TIMEOUT` + audit `FOLLOWUP_EXECUTE_FAILED` (já existe lazy) |

### 5.4 Resposta

```json
{
  "dryRun": true,
  "results": {
    "pending_messages": { "matched": 2, "updated": 0 },
    "executing_followups": { "matched": 1, "updated": 0 }
  }
}
```

### 5.5 Agendamento

**O4 recomendação:** sem BullMQ na 4.5.  
Opções: (a) chamada manual no Ops UI; (b) cron externo → `POST /ops/reconcile`; (c) lazy continua no FollowUp.

### 5.6 Segurança

- Sempre `companyId = JWT.cid`  
- dryRun default **true** na primeira UI  
- Audit `OPS_RECONCILE` com before/after counts  

---

## 6. Audit Explorer

### 6.1 Estado atual

`AuditService.write` apenas; **sem** listagem HTTP.

### 6.2 Endpoints propostos

```http
GET /api/ops/audit
GET /api/ops/audit/:id
```

Roles: OWNER | ADMIN (AGENT read — **O1**).

### 6.3 Filtros

| Query | Tipo |
|---|---|
| `action` | string / prefix |
| `targetType` | string |
| `targetId` | uuid |
| `actorUserId` | uuid |
| `actorType` | USER \| SYSTEM |
| `from` / `to` | occurredAt |
| `page` / `limit` | paginação (max 100) |

Ordenação: `occurredAt DESC`.

### 6.4 Response item (resumo)

```json
{
  "id": "...",
  "action": "FOLLOWUP_EXECUTE",
  "targetType": "FOLLOWUP",
  "targetId": "...",
  "actorType": "USER",
  "actorUserId": "...",
  "occurredAt": "...",
  "after": { "...": "snapshot truncado se necessário" }
}
```

### 6.5 Regras

- Tenant obrigatório  
- Não retornar linhas de outras companies  
- Truncar JSON grande (before/after) na listagem; full no GET by id  
- Soft-delete: `deletedAt IS NULL`  

Actions de interesse ops (não exclusivo):  
`WHATSAPP_*`, `FOLLOWUP_*`, `OPS_RECONCILE`, `LEAD_*`, `MESSAGE_*`, auth sensível opcional (login failures — se existirem).

---

## 7. Webhook Monitor

### 7.1 Estado atual

Persistência `WebhookEvent` (Fase 2); ingest `POST /api/whatsapp/webhook/:instanceKey`.  
Sem UI/API de consulta.

### 7.2 Endpoints propostos

```http
GET /api/ops/webhooks
GET /api/ops/webhooks/:id
```

Roles: OWNER | ADMIN.

### 7.3 Filtros

| Query | Tipo |
|---|---|
| `status` | RECEIVED\|PROCESSED\|FAILED\|IGNORED\|DUPLICATE |
| `eventType` | string |
| `instanceId` | uuid |
| `externalEventId` | string |
| `from` / `to` | receivedAt |
| `page` / `limit` | |

### 7.4 List item

```json
{
  "id": "...",
  "eventType": "messages.upsert",
  "status": "FAILED",
  "error": "...",
  "externalEventId": "...",
  "instanceId": "...",
  "receivedAt": "...",
  "processedAt": "..."
}
```

### 7.5 Detalhe

Inclui `payload` **redatado** (remover possíveis tokens; truncar >50KB — já truncated no ingest).

### 7.6 Ações futuras (fora do MVP 4.5 ou stretch)

| Ação | Descrição |
|---|---|
| Replay FAILED | Reprocessar evento respeitando idempotência Message — **O5 stretch** |

MVP 4.5: **somente leitura** + métricas no ops dashboard.

---

## 8. Métricas de WhatsApp

### 8.1 Connection

| Métrica | Tipo |
|---|---|
| `whatsapp_instance_status` | gauge/label por status |
| `whatsapp_connected` | 0/1 |
| `whatsapp_last_connected_at` | timestamp |

### 8.2 Mensagens

| Métrica | Tipo | Labels sugeridos |
|---|---|---|
| `whatsapp_messages_outbound_total` | counter | status |
| `whatsapp_messages_inbound_total` | counter | — |
| `whatsapp_messages_pending_stale` | gauge | — |
| `whatsapp_send_failures_total` | counter | — |
| `whatsapp_delivery_rate` | ratio | período |
| `whatsapp_echo_healed_total` | counter | (se auditável via WebhookEvent error ECHO_HEALED) |

### 8.3 Webhooks

| Métrica | Tipo |
|---|---|
| `whatsapp_webhook_events_total` | counter | status, eventType |
| `whatsapp_webhook_processing_latency_ms` | histogram | processedAt−receivedAt |

### 8.4 Exposição

**O6 recomendação Fase 4.5:**  
1. Primário: JSON em `/api/ops/dashboard` + `/api/ops/metrics` (agregados SQL)  
2. Secundário (opcional): `GET /metrics` Prometheus **só se** ops pedir — não bloquear MVP  

---

## 9. Métricas de FollowUp

| Métrica | Definição |
|---|---|
| `followup_by_status` | count por FollowUpStatus (ativos) |
| `followup_executed_total` | EXECUTED no período |
| `followup_failed_total` | FAILED no período |
| `followup_cancelled_total` | CANCELLED |
| `followup_overdue` | SCHEDULED/APPROVED ∧ scheduledAt < now (já no dashboard) |
| `followup_executing_stale` | EXECUTING > 5m |
| `followup_retry_exhausted` | FAILED ∧ attemptCount ≥ 3 |
| `followup_execution_success_rate` | EXECUTED / (EXECUTED+FAILED) |
| `followup_avg_attempts` | avg(attemptCount) entre EXECUTED+FAILED no período |
| `followup_time_to_execute` | executedAt − approvedAt (p50/p95 — stretch) |

Integração: bloco C do Ops Dashboard + endpoint metrics.

---

## 10. Métricas de Conversão

Reutilizar e **explicitar** no Ops (além do Dashboard analytics):

| Métrica | Definição (congelar alinhado ao MVP) |
|---|---|
| `leads_total` | leads ativos no período / lifetime (param) |
| `leads_new` | status NEW criados no período |
| `leads_converted` | CONVERTED (por convertedAt ou status — **manter regra dashboard atual**) |
| `leads_lost` | LOST |
| `conversion_rate` | converted / (converted+lost) ou total — **documentar exatamente como dashboard** |
| `contacted_rate` | CONTACTED+ / total |
| `leads_with_inbound` | lastInboundAt not null |
| `leads_with_outbound` | lastOutboundAt not null |
| `response_funnel` | NEW→CONTACTED→RESPONDED→QUALIFIED→CONVERTED counts |

### 10.1 Funil operacional (proposta UI)

```text
Leads criados → Contatados (WhatsApp) → Responderam → Qualificados → Convertidos
                     ↑                      ↑
              outbound SENT          inbound RECEIVED
```

Ops destaca **vazamentos**: leads CONTACTED sem outbound; outbound FAILED alto; FollowUp FAILED alto.

---

## 11. Estratégia de observabilidade

### 11.1 Pilares

| Pilar | Fase 4.5 |
|---|---|
| **Logs** | Structured JSON (Nest Logger): requestId, companyId, action, followUpId, messageId |
| **Metrics** | SQL aggregates via Ops APIs (MVP); Prometheus opcional |
| **Traces** | Fora do MVP (OpenTelemetry futuro) |
| **Audits** | Audit Explorer (já append-only) |
| **Technical events** | Webhook Monitor |

### 11.2 Correlação

IDs a propagar em logs/audit metadata:
- `companyId`, `requestId` (middleware futuro)
- `followUpId`, `messageId`, `externalMessageId`
- `webhookEventId`, `instanceKey` (não secret)

### 11.3 Alertas (operacionais)

| Alerta | Condição sugerida | Canal futuro |
|---|---|---|
| WhatsApp down | status ≠ CONNECTED > 10m | Slack/email |
| PENDING stale | count > 0 | Ops dashboard badge |
| EXECUTING stale | count > 0 | badge + reconcile |
| Webhook FAILED spike | > N / 15m | badge |
| FollowUp retry exhausted | count aumenta | badge |

MVP 4.5: **badges no Ops Dashboard**; sem notificações push obrigatórias (**O7**).

### 11.4 Retenção

| Dado | Retenção proposta |
|---|---|
| WebhookEvent payload | 30 dias (depois purge/archive) — **O8** |
| AuditLog | 1 ano (compliance leve) |
| Metrics raw | agregados diários |

### 11.5 Logging de erros

- Nunca logar `X-Webhook-Secret`, JWT, refresh tokens  
- Truncar bodies de mensagem em logs (≤200 chars)  

---

## 12. Modelo de APIs (resumo)

| Método | Path | Roles | Função |
|---|---|---|---|
| GET | `/api/ops/dashboard` | OWNER/ADMIN/(AGENT?) | Painel ops |
| GET | `/api/ops/health` | OWNER/ADMIN | Health produto |
| GET | `/api/ops/metrics` | OWNER/ADMIN | Agregados WhatsApp/FollowUp/Conversão |
| GET | `/api/ops/audit` | OWNER/ADMIN/(AGENT?) | Audit Explorer list |
| GET | `/api/ops/audit/:id` | OWNER/ADMIN/(AGENT?) | Audit detail |
| GET | `/api/ops/webhooks` | OWNER/ADMIN | Webhook Monitor list |
| GET | `/api/ops/webhooks/:id` | OWNER/ADMIN | Webhook detail |
| POST | `/api/ops/reconcile` | OWNER/ADMIN | Reconciliação |
| GET | `/health/ready` | público | DB ready (avançado) |

Prefixo `ops` evita colidir com `/api/dashboard` analytics.

---

## 13. Multi-tenancy & segurança

| Regra | Detalhe |
|---|---|
| Tenant | JWT.cid em todas as rotas `/api/ops/*` |
| Health público | sem dados de tenant |
| Webhook payloads | redaction; só company da instance |
| Reconcile | só rows da company |
| Cross-tenant IDs | 404 |
| Secrets | nunca em responses ops |

---

## 14. Critérios de aceite (implementação futura)

- [ ] `GET /api/ops/dashboard` com blocos WhatsApp, mensagens, FollowUp, webhooks, alertas  
- [ ] `GET /health/ready` com probe Postgres  
- [ ] `GET /api/ops/health` com status ok/degraded/error  
- [ ] Audit Explorer list + get (filtros + paginação + tenant)  
- [ ] Webhook Monitor list + get (filtros + tenant)  
- [ ] `POST /api/ops/reconcile` com dryRun + targets PENDING/EXECUTING  
- [ ] Métricas WhatsApp / FollowUp / Conversão documentadas e expostas em `/api/ops/metrics` ou dashboard  
- [ ] Sem IA / filas obrigatórias / deploy prod nesta fase  
- [ ] `docs/operations-review.md` após implementação  
- [ ] Testes: tenant isolation, reconcile dryRun, ready falha se DB down (se testável)  

---

## 15. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| Ops APIs caras (full scan) | Média | Índices existentes; limites de período; paginação |
| Expor payload webhook sensível | Alta | Redaction + roles ADMIN |
| Reconcile agressivo marca SENT real como FAILED | Alta | Só PENDING>5m; dryRun default; audit |
| Duplicar Dashboard analytics | Baixa | Ops = saúde; Dashboard = negócio |
| Alert fatigue | Baixa | Poucos badges; limiares conservadores |
| AGENT vê dados demais | Média | O1: AGENT só read em subset |
| Retenção WebhookEvent cresce | Média | O8 purge 30d |

---

## 16. Decisões pedindo aprovação

| ID | Pergunta | Recomendação |
|---|---|---|
| **O1** | AGENT pode ler Ops Dashboard/Audit? | **Sim, read-only**; reconcile só OWNER/ADMIN |
| **O2** | Incluir spike detection de webhooks no MVP? | **Só count FAILED 15m**; sem anomaly ML |
| **O3** | Reconcile auto-fail PENDING messages? | **Sim** (com dryRun) |
| **O4** | Cron interno vs externo para reconcile? | **Manual + cron externo** |
| **O5** | Replay de webhook na 4.5? | **Não** (stretch) |
| **O6** | Prometheus `/metrics` na 4.5? | **Não** (JSON ops primeiro) |
| **O7** | Notificações Slack/email? | **Não** nesta fase |
| **O8** | Retenção WebhookEvent 30 dias? | **Sim** (job purge futuro) |
| **O9** | UI frontend nesta fase ou só APIs? | **APIs primeiro**; UI pode ser fase 4.5b |
| **O10** | Prefixo `/api/ops/*`? | **Sim** |

---

## 17. Relação com roadmap

| Fase | Estado |
|---|---|
| WhatsApp 1–4 + FollowUp | Feitas |
| **4.5 Operations & Observability** | **Este design** |
| 5 IA assistiva | Depende de ops estável para confiar em automação |

---

## 18. Próximo passo

**Aguardar aprovação** deste design (e O1…O10).  
Somente após aprovação explícita → implementar camada ops.  
**Nenhum código nesta etapa.**

---

*Fim do design Operations & Observability (Fase 4.5).*
