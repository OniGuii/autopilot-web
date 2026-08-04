# Fase 9 — CRM Operations & Customer Success (Design)

**Status:** Design — aguardando aprovação  
**Escopo:** camada operacional de CRM (timeline, notes, activities, pipeline, ownership, SLA design)  
**Fora de escopo (não alterar):** Auth, WhatsApp Engine, AI Engine, Workers, RLS infrastructure, Outbound, frontend, deploy  
**Referências:** `domain-model.md`, `domain-decisions.md` (D1/D2/D7/D10), `leads-design.md`, `dashboard-design.md`, `rls-review.md`, `tenant-safety.md`

---

## 1. Objetivo

Transformar o Autopilot de plataforma técnica (mensageria + IA + workers) em **ferramenta operacional** para equipes comerciais: contexto do lead em uma linha do tempo, anotações, atividades agendadas, visão de pipeline e gestão de ownership.

Princípios:

| Princípio | Regra |
|---|---|
| Não é CRM genérico | Pipeline = estágios **D1** (`NEW`…`CONVERTED`/`LOST`); sem pipelines customizados |
| Tenant | `companyId = JWT.cid` apenas |
| Soft delete | `deletedAt` em entidades novas e queries |
| Auditoria | Mutações escrevem `AuditLog` na mesma transação |
| RLS | Novas tabelas tenant entram no mesmo padrão 8B (`FORCE RLS` + `app.company_id`) |
| Complementar Dashboard | `GET /api/pipeline` é visão operacional de funil; **não** reimplementa `/api/dashboard/*` |

---

## 2. Decisões de design (propostas)

| ID | Decisão | Proposta |
|---|---|---|
| C1 | Timeline | API de **composição** (sem nova tabela). Fontes: Message, FollowUp, Conversation, AuditLog (filtrado), LeadNote, LeadActivity. `Event` domain permanece opcional (hoje não é emitido). |
| C2 | AI na timeline | FollowUp com `type=AI_REPLY` e/ou `metadata.source='ai'` → item `AI_SUGGESTION` |
| C3 | Assign | `POST /api/leads/:id/assign` **já existe** — Fase 9 adiciona `unassign` + `bulk-assign` e documenta contrato estável |
| C4 | Tempo médio por estágio | Derivado de transições em `AuditLog` (`LEAD_CREATE` / `LEAD_UPDATE` / `LEAD_ASSIGN` com mudança de `status`). Sem tabela de histórico nesta fase; risco documentado |
| C5 | Roles | `OWNER \| ADMIN \| AGENT` (igual Leads MVP); bulk-assign pode restringir a `OWNER\|ADMIN` (decisão aberta — default: três roles) |
| C6 | SLA | **Somente design** nesta fase — sem workers, jobs ou alertas Ops novos |
| C7 | Soft delete Notes/Activities | DELETE = soft (`deletedAt`); listagens excluem deletados |

---

## 3. Lead Timeline

### 3.1 Endpoint

```http
GET /api/leads/:id/timeline
Authorization: Bearer …
```

Guards: `JwtAuthGuard` + `CompanyContextGuard` + `RolesGuard` (`OWNER|ADMIN|AGENT`).

Query opcional (proposta):

| Param | Default | Descrição |
|---|---|---|
| `limit` | `100` | Máx. itens retornados (cap 500) |
| `cursor` | — | Paginação por `occurredAt`+`id` (opcional v1) |
| `types` | todos | Filtro CSV de `itemType` |

Cross-tenant / lead soft-deleted → **404**.

### 3.2 Fontes e mapeamento

| Fonte | `itemType` | Timestamp | Notas |
|---|---|---|---|
| Lead (criação) | `LEAD_CREATED` | `lead.createdAt` | Um item sintético do próprio Lead |
| `AuditLog` (subset) | `AUDIT_*` ou tipos tipados | `occurredAt` | Ver §3.3 |
| `Conversation` | `CONVERSATION_OPENED` / `CONVERSATION_CLOSED` | `createdAt` / update relevante | Status CLOSED/ARCHIVED |
| `Message` | `MESSAGE_INBOUND` / `MESSAGE_OUTBOUND` | `createdAt` (ou `sentAt`) | Via conversations do lead |
| `FollowUp` (não-AI) | `FOLLOW_UP` | `createdAt` / `scheduledAt` / `executedAt` | Preferir `createdAt` para ordenação única; metadados carregam demais |
| `FollowUp` AI | `AI_SUGGESTION` | `createdAt` | `type=AI_REPLY` ou `metadata.source=ai` |
| `LeadNote` | `NOTE` | `createdAt` | Nova entidade |
| `LeadActivity` | `ACTIVITY` | `createdAt` (planejado: `scheduledAt` no payload) | Nova entidade |
| WhatsApp (via Message/Audit) | `WHATSAPP_*` | audit/message | Não ler Evolution direto; usar Message + audits `WHATSAPP_MESSAGE_*` |

**Não incluir nesta v1:** `WebhookEvent` raw, `OPS_RECONCILE_*`, dumps de payload Evolution.

### 3.3 Audit actions relevantes (whitelist)

Incluir quando `targetType/targetId` ou `after.leadId` apontar ao lead (ou conversation/message/followUp do lead):

- `LEAD_CREATE`, `LEAD_UPDATE`, `LEAD_ASSIGN`, `LEAD_DELETE`, `LEAD_AUTO_CREATED`
- `CONVERSATION_*` (create/close/auto)
- `MESSAGE_CREATE`
- `FOLLOWUP_*`, `AI_SUGGESTION_*`
- `WHATSAPP_MESSAGE_SENT|RECEIVED|DELIVERED|READ|FAILED`

Excluir: `OPS_*`, `WHATSAPP_CONNECT/DISCONNECT` (nível instância — fora do lead).

### 3.4 Shape da response

```json
{
  "leadId": "uuid",
  "companyId": "uuid",
  "items": [
    {
      "id": "stable-key",
      "itemType": "MESSAGE_INBOUND",
      "occurredAt": "ISO-8601",
      "actorUserId": "uuid|null",
      "summary": "short text",
      "payload": { }
    }
  ]
}
```

- `id`: chave estável `{source}:{uuid}` (ex. `message:…`, `followup:…`, `audit:…`, `note:…`) para dedupe client-side  
- Ordenação: **`occurredAt ASC`**, desempate `id ASC`  
- `payload`: subset seguro (sem secrets); body truncado (ex. 2k chars)

### 3.5 Implementação (pós-aprovação)

Serviço `LeadTimelineService` no módulo Leads (ou submódulo `crm/`):

1. Valida lead tenant  
2. Carrega conversas do lead → messages  
3. Carrega followUps do lead  
4. Carrega notes/activities  
5. Carrega audits filtrados (por `targetId` in ids relacionados **ou** `after.leadId`)  
6. Normaliza → sort → limit  

Sem cache nesta fase. Sem alterar workers/WhatsApp/AI.

---

## 4. Lead Notes

### 4.1 Entidade `LeadNote`

| Campo | Tipo | Regra |
|---|---|---|
| `id` | UUID PK | |
| `companyId` | UUID FK → companies | = JWT.cid |
| `leadId` | UUID FK → leads | mesmo tenant |
| `userId` | UUID FK → users | autor = `JWT.sub` no create |
| `body` | Text (limit API ex. 10_000) | trim; required |
| `createdAt` / `updatedAt` | timestamptz | |
| `deletedAt` | timestamptz? | soft delete |

Índices: `(company_id, lead_id, created_at)`, `(company_id, user_id)`.

RLS: mesma policy `tenant_isolation` (8B) — **migration RLS obrigatória** junto com create table.

### 4.2 Endpoints

| Método | Path | Descrição |
|---|---|---|
| `POST` | `/api/leads/:leadId/notes` | Criar (`userId=sub`) |
| `GET` | `/api/leads/:leadId/notes` | Listar (`deletedAt IS NULL`, `createdAt DESC`) |
| `GET` | `/api/leads/:leadId/notes/:id` | Detalhe |
| `PATCH` | `/api/leads/:leadId/notes/:id` | Atualizar `body` (autor ou OWNER/ADMIN — decisão: **autor ou ADMIN/OWNER**) |
| `DELETE` | `/api/leads/:leadId/notes/:id` | Soft delete → **204** |

Auditoria: `LEAD_NOTE_CREATE` | `LEAD_NOTE_UPDATE` | `LEAD_NOTE_DELETE`.

---

## 5. Lead Activities

### 5.1 Conceito

Atividade operacional **humana** (não confundir com FollowUp de recovery/WhatsApp nem com Event técnico).

### 5.2 Enums

```text
LeadActivityType:   CALL | MEETING | EMAIL | VISIT | OTHER
LeadActivityStatus: PLANNED | DONE | CANCELLED
```

### 5.3 Entidade `LeadActivity`

| Campo | Tipo | Regra |
|---|---|---|
| `id` | UUID | |
| `companyId` | UUID | JWT.cid |
| `leadId` | UUID | |
| `userId` | UUID? | responsável (default `sub` no create; opcional reassign) |
| `type` | enum | |
| `status` | enum | default `PLANNED` |
| `title` | varchar(200) | required |
| `body` | text? | notas |
| `scheduledAt` | timestamptz? | agendamento opcional |
| `completedAt` | timestamptz? | set ao marcar `DONE` |
| `createdAt` / `updatedAt` / `deletedAt` | | soft delete |

Índices: `(company_id, lead_id, scheduled_at)`, `(company_id, status, scheduled_at)`, `(company_id, user_id, status)`.

RLS: tenant_isolation (8B).

### 5.4 Endpoints

| Método | Path | Descrição |
|---|---|---|
| `POST` | `/api/leads/:leadId/activities` | Criar |
| `GET` | `/api/leads/:leadId/activities` | Listar (+ filtros `status`, `type`) |
| `GET` | `/api/leads/:leadId/activities/:id` | Detalhe |
| `PATCH` | `/api/leads/:leadId/activities/:id` | Atualizar campos / status |
| `POST` | `/api/leads/:leadId/activities/:id/complete` | Atalho → `DONE` + `completedAt` |
| `POST` | `/api/leads/:leadId/activities/:id/cancel` | → `CANCELLED` |
| `DELETE` | `/api/leads/:leadId/activities/:id` | Soft delete 204 |

Transições de status:

```text
PLANNED → DONE | CANCELLED
DONE → (imutável nesta fase; sem reabrir)
CANCELLED → (imutável)
```

Auditoria: `LEAD_ACTIVITY_CREATE|UPDATE|COMPLETE|CANCEL|DELETE`.

---

## 6. Pipeline Dashboard

### 6.1 Endpoint

```http
GET /api/pipeline
```

Somente leitura. Guards iguais ao Dashboard. Query opcional: `from` / `to` (filtra leads por `createdAt`, alinhado ao dashboard).

### 6.2 KPIs (operacionais)

| KPI | Definição |
|---|---|
| `leadsByStage` | Contagem `Lead.status` (D1) com `deletedAt IS NULL` — espelha espírito de `/dashboard/leads`, mas vive sob `/pipeline` como board operacional |
| `conversionByStage` | Para cada estágio (exceto terminais): taxa de leads que **passaram** pelo estágio e chegaram a `CONVERTED` (via histórico de audit; ver C4). V1 pode simplificar: `converted / (converted+lost+active)` global + funnel counts |
| `avgTimeInStageMs` | Média do tempo entre entrada e saída do estágio (audit transitions). Estágio atual: `now - enteredAt` |
| `leadsWithoutContact` | `lastContactAt IS NULL` **e** sem messages (ou só `lastContactAt IS NULL` — **preferência:** `lastContactAt IS NULL`) |
| `leadsUnassigned` | `ownerId IS NULL` |

### 6.3 Relação com Dashboard existente

| Dashboard | Pipeline |
|---|---|
| `/dashboard/overview` conversionRate global | Funil + tempo por estágio + hygiene (sem contato / sem owner) |
| `/dashboard/leads` byStatus | `leadsByStage` pode coincidir numericamente — aceitável; pipeline agrega KPIs de **operação comercial** numa única response |

**Não** incluir: messages sent/received, followup overdue (já no dashboard), métricas WhatsApp/IA/queues.

### 6.4 Response (proposta)

```json
{
  "companyId": "uuid",
  "generatedAt": "ISO-8601",
  "period": { "from": null, "to": null },
  "leadsByStage": { "NEW": 0, "CONTACTED": 0, "RESPONDED": 0, "QUALIFIED": 0, "CONVERTED": 0, "LOST": 0 },
  "conversionByStage": { "NEW": 0.12, "CONTACTED": 0.2, "...": 0 },
  "avgTimeInStageMs": { "NEW": 86400000, "...": null },
  "leadsWithoutContact": 3,
  "leadsUnassigned": 5
}
```

Taxas: decimal **0–1** (igual dashboard).

### 6.5 Limitação C4

Sem `LeadStatusHistory`, `avgTimeInStageMs` / conversão por estágio dependem de qualidade do `AuditLog`.  
Mitigação futura (fora do MVP 9 se custo alto): tabela `lead_status_transitions` preenchida no `LeadsService` em mudanças de status — **só se aprovado** (impacto mínimo no domínio Lead, sem tocar WhatsApp/AI).

---

## 7. Ownership Management

### 7.1 Já implementado

```http
POST /api/leads/:id/assign
Body: { "ownerId": "uuid" }
Audit: LEAD_ASSIGN
```

Regras atuais mantidas: membership ACTIVE na company; 404 cross-tenant.

### 7.2 Novos endpoints

| Método | Path | Body | Descrição |
|---|---|---|---|
| `POST` | `/api/leads/:id/unassign` | — (vazio) | `ownerId = null`; audit `LEAD_UNASSIGN` |
| `POST` | `/api/leads/bulk-assign` | `{ ownerId, leadIds: uuid[] }` | Atribuição em massa |

### 7.3 Bulk-assign

Regras:

- `leadIds` max **100** por request  
- `ownerId` deve ser membership ACTIVE  
- Processar só leads `companyId=cid` e `deletedAt IS NULL`  
- IDs inexistentes/outra company → contados em `ignorados` (não 404 total)  
- Response:

```json
{
  "ownerId": "uuid",
  "requested": 10,
  "updated": 8,
  "ignored": 2,
  "ignoredIds": ["…"]
}
```

- Uma audit `LEAD_BULK_ASSIGN` (after: `{ ownerId, leadIds: updated[] }`) **ou** uma `LEAD_ASSIGN` por lead (preferência: **uma por lead** para timeline/audit consistency; bulk audit opcional adicional)

`unassign` em massa: **fora desta fase** (pode ser `bulk-assign` com `ownerId: null` se aprovado — proposta: **permitir `ownerId: null` em bulk** = bulk unassign).

---

## 8. SLA Engine (somente design)

Sem implementação, workers, crons ou alertas nesta fase.

### 8.1 Definições

| SLA | Condição candidata | Severidade sugerida |
|---|---|---|
| **Lead sem resposta** | Existe Message INBOUND mais recente que qualquer OUTBOUND do mesmo lead (ou `lastInboundAt > lastOutboundAt`) e idade > `SLA_NO_REPLY_MS` (ex. 15min / 1h configurável) | warning |
| **Follow-up atrasado** | FollowUp `SCHEDULED` com `scheduledAt < now` e `deletedAt IS NULL` (já parcialmente coberto por dashboard `overdue`) | warning |
| **Conversa parada** | Conversation `OPEN\|IDLE` com `lastMessageAt < now - SLA_IDLE_MS` (ex. 24h) e lead não `CONVERTED\|LOST` | info/warning |

### 8.2 Superfície futura (não implementar agora)

- `GET /api/sla/breaches` ou seção em `/api/pipeline`  
- Alertas Ops `SLA_*`  
- Scanner/worker dedicado (pós-Fase 9)  
- Flags `SLA_*_ENABLED`, thresholds em env  

### 8.3 Compatibilidade

Reutilizar timestamps já existentes (`lastInboundAt`, `lastOutboundAt`, `lastContactAt`, `scheduledAt`, `lastMessageAt`) — **sem** mudar WhatsApp/AI engines.

---

## 9. Regras transversais

| Área | Obrigatório |
|---|---|
| Multi-tenancy | `JWT.cid` em toda query/mutation |
| Auth | JWT + company context + roles |
| Soft delete | Notes, Activities, (leads já) |
| Auditoria | Toda mutação CRM |
| RLS | ENABLE+FORCE nas tabelas novas; GUC `app.company_id` (extension 8B) |
| Prisma Tenant Extension | Models novos em `TENANT_SCOPED_MODELS` |
| APIs públicas existentes | Não quebrar contratos sync de send/AI/dashboard |
| Frontend | Não |
| WhatsApp / AI / Workers / Auth | Não alterar |

---

## 10. Migrations necessárias (pós-aprovação)

1. **`lead_notes`** — create table + FKs + indexes + RLS policies  
2. **`lead_activities`** — enums + table + FKs + indexes + RLS policies  
3. (Opcional, se C4 endurecer) **`lead_status_transitions`** — append-only history  

Nenhuma migration em Auth/WhatsApp/Messages/FollowUps/RLS helpers existentes (apenas **ADD** policies para tabelas novas).

Seed: opcional notes/activities em profile `demo` (não bloquear).

---

## 11. Endpoints — mapa completo

| Método | Path | Fase |
|---|---|---|
| `GET` | `/api/leads/:id/timeline` | novo |
| `POST/GET/PATCH/DELETE` | `/api/leads/:leadId/notes[/:id]` | novo |
| `POST/GET/PATCH/DELETE` + complete/cancel | `/api/leads/:leadId/activities[/:id]…` | novo |
| `GET` | `/api/pipeline` | novo |
| `POST` | `/api/leads/:id/assign` | **existente** |
| `POST` | `/api/leads/:id/unassign` | novo |
| `POST` | `/api/leads/bulk-assign` | novo |

---

## 12. Impacto no domínio

| Impacto | Detalhe |
|---|---|
| Novas entidades | `LeadNote`, `LeadActivity` (+ enums) |
| Lead | Sem mudança de campos D1; relations `notes[]`, `activities[]` |
| Event store | Timeline **não** depende de emitir `Event` (gap atual permanece) |
| FollowUp / Message | Somente leitura na timeline |
| Dashboard | Sem mudança; pipeline é endpoint irmão |
| Ownership | Extensão do fluxo assign já existente |

**Não** introduz pipelines custom, tags, score automático, campanhas (D5).

---

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Timeline pesada (N+1 / payloads grandes) | limit/cap; truncate bodies; índices; paginação cursor na v1.1 |
| Duplicata Message vs Audit WhatsApp | Deduplicar por preferência Message; audit só quando não houver message |
| `avgTimeInStage` impreciso sem history | Documentar; opcional `lead_status_transitions` |
| Bulk-assign parcial | Response com `ignored`; nunca vazamento cross-tenant |
| Confusão Activity vs FollowUp | Docs + `itemType` distintos; Activity nunca dispara WhatsApp |
| Escopo creep para SLA/workers | SLA permanece design-only até aprovação explícita |

---

## 14. Ordem recomendada de implementação

```text
9.1  LeadNote (+ migration RLS + audit + testes)
9.2  LeadActivity (+ enums + endpoints + testes)
9.3  Ownership: unassign + bulk-assign
9.4  GET /leads/:id/timeline (composição)
9.5  GET /pipeline (KPIs; avgTime best-effort via audit)
9.6  (Futuro) SLA engine + opcional LeadStatusHistory
```

Cada subfase: unit + e2e smoke + lint/build; **sem** frontend; **sem** alterar engines.

---

## 15. Fora desta fase (explícito)

- Implementação de código antes da aprovação deste design  
- Frontend / UI  
- Alterações Auth, WhatsApp, AI, Workers, Outbound  
- Mudanças em policies RLS genéricas (só ADD para tabelas novas)  
- SLA runtime / alertas Ops  
- Importação CSV, tags, custom fields, score automático  
- Emissão completa do Event store  

---

## 16. Critérios de aprovação do design

- [ ] Confirmar C4 (audit vs `lead_status_transitions`)  
- [ ] Confirmar se bulk permite `ownerId: null`  
- [ ] Confirmar RBAC de bulk-assign (AGENT vs OWNER/ADMIN)  
- [ ] Confirmar whitelist de audits na timeline  
- [ ] Confirmar path notes/activities aninhados em `/leads/:id/…`  

**Após aprovação:** abrir sub-PRs na ordem §14 — sem iniciar Fase 10 / frontend / SLA runtime.
