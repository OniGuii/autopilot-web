# Dashboard Design — Analytics MVP

**Status:** Aprovado → **implementado** (ver `dashboard-review.md`)  
**Fase:** 6 — Dashboard MVP  
**Pré-requisitos:** Auth + Leads + Conversations + Follow-Ups  
**Referências:** `domain-decisions.md` (D1, D2, D3, D7, D10), `schema.prisma`, `leads-review.md`, `conversations-review.md`, `followups-review.md`

### Decisões congeladas na aprovação

- Routes: `GET /api/dashboard`, `/overview`, `/leads`, `/conversations`, `/followups`
- `conversionRate` = decimal **0–1**
- Open = **OPEN + IDLE** · Closed = **CLOSED + ARCHIVED**
- `from`/`to` habilitados (filtra `createdAt`)
- `overdue` **ignora** período
- Roles: OWNER / ADMIN / AGENT
- Extra: `avgMessagesPerConversation`; leads `byStatus` chave/valor

---

## 1. Objetivo

Expor uma **camada REST somente leitura** de indicadores (KPIs) para a company autenticada.

**Inclui:**
- Endpoints REST de analytics  
- Agregações Prisma filtradas por `JWT.cid`  
- Definições explícitas de cada KPI  

**Fora deste MVP (não implementar):**
- Frontend / UI / gráficos  
- Cache (Redis, materialização, pre-agregação)  
- Export CSV/PDF  
- Comparação de períodos / time-series / sparklines  
- Realtime (websocket)  
- WhatsApp / IA / n8n  
- Ativação da Prisma Tenant Extension global  

---

## 2. Princípios

| Princípio | Regra |
|---|---|
| Multi-tenant | Toda query usa `companyId = JWT.cid` |
| Auth | `JwtAuthGuard` + `CompanyContextGuard` + roles `OWNER\|ADMIN\|AGENT` |
| Somente leitura | Sem `POST/PATCH/DELETE` de mutação de domínio |
| Sem `companyId` no client | Query/body com `companyId` → **400** (se houver query DTO) |
| Soft delete | Conta apenas `deletedAt IS NULL` |
| Sem cache | Queries ao vivo no Postgres nesta fase |
| Sem gráficos | Response = JSON numérico / buckets |

---

## 3. Endpoints propostos

Prefixo global: `api`.

### Opção recomendada (MVP enxuto)

| Método | Path | Descrição |
|---|---|---|
| `GET` | `/api/dashboard` | Payload completo com todos os blocos de KPI |
| `GET` | `/api/dashboard/overview` | Só bloco Overview |
| `GET` | `/api/dashboard/conversations` | Só bloco Conversations |
| `GET` | `/api/dashboard/follow-ups` | Só bloco FollowUps |
| `GET` | `/api/dashboard/leads-by-status` | Só agrupamento por status |

O endpoint agregado `GET /api/dashboard` é o contrato principal do MVP.  
Os endpoints parciais evitam over-fetch no futuro e são baratos de manter (mesmo service).

**Alternativa mínima (se preferir 1 route só):** apenas `GET /api/dashboard`.  
**Decisão pedida em §11.**

---

## 4. Query params (período — opcional)

| Param | Tipo | Default | Descrição |
|---|---|---|---|
| `from` | ISO datetime | — | início inclusivo do período |
| `to` | ISO datetime | — | fim inclusivo do período |

### Semântica de período (proposta)

| Bloco | Campo temporal usado quando `from`/`to` presentes |
|---|---|
| Overview (`total/new/converted/lost`) | `Lead.createdAt` |
| Conversations (open/closed) | `Conversation.createdAt` |
| Messages sent/received | `Message.createdAt` |
| FollowUps pending/executed | `FollowUp.createdAt` |
| FollowUps overdue | **sempre “agora”** (`scheduledAt < now`), independente do período* |
| Leads by status | `Lead.createdAt` |

\* Overdue é estado corrente; filtrar por período de criação distorce o KPI.  
**Decisão §11:** overdue ignora `from`/`to` (recomendado).

Se `from`/`to` omitidos → **all-time** (tudo da company, soft-deleted excluído).

Validação: se ambos presentes, `from <= to`; senão **400**.

---

## 5. KPIs — definições

Todas as contagens: `companyId = JWT.cid` AND `deletedAt IS NULL`.

### 5.1 Overview

| KPI | Definição |
|---|---|
| `totalLeads` | `COUNT(leads)` |
| `newLeads` | `status = NEW` |
| `convertedLeads` | `status = CONVERTED` |
| `lostLeads` | `status = LOST` |
| `conversionRate` | `convertedLeads / totalLeads` se `totalLeads > 0`, senão `0` |

`conversionRate` retornado como **número decimal 0–1** (ex.: `0.125`) **ou** percentual 0–100.  
**Proposta:** decimal `0–1` com até 4 casas (`0.1250`) — UI multiplica por 100.  
**Decisão §11.**

> Nota D2: `CONVERTED` = objetivo comercial alcançado (não necessariamente venda).

### 5.2 Conversations

| KPI | Definição |
|---|---|
| `openConversations` | `status = OPEN` |
| `closedConversations` | `status = CLOSED` |
| `messagesSent` | `Message.direction = OUTBOUND` |
| `messagesReceived` | `Message.direction = INBOUND` |

Estados `IDLE` e `ARCHIVED` **não** entram em open/closed nesta fase (ficam de fora dos dois contadores).  
**Decisão §11** se devem ser somados (ex.: open = OPEN+IDLE).

### 5.3 FollowUps

| KPI | Definição |
|---|---|
| `pending` | `status IN (SUGGESTED, APPROVED, SCHEDULED)` |
| `overdue` | `status IN (APPROVED, SCHEDULED) AND scheduledAt IS NOT NULL AND scheduledAt < now()` |
| `executed` | `status = EXECUTED` |
| `executionRate` | `executed / (executed + pending)` se denominador > 0, senão `0` |

Observações:
- `overdue` ⊆ logicamente relacionados a pending (APPROVED/SCHEDULED), mas `pending` também inclui `SUGGESTED`.
- `REJECTED` / `FAILED` / etc. **não** entram em `pending` nem no denominador de `executionRate` neste MVP.
- Alinhado ao filtro `overdue=true` do módulo Follow-Ups.

### 5.4 Leads by Status

Agrupamento completo do enum D1:

```json
{
  "NEW": 10,
  "CONTACTED": 8,
  "RESPONDED": 5,
  "QUALIFIED": 3,
  "CONVERTED": 2,
  "LOST": 4
}
```

Sempre retornar **todas** as chaves do enum (mesmo com `0`), para o client não precisar tratar ausência.

---

## 6. Contratos de response

### `GET /api/dashboard`

```json
{
  "companyId": "<uuid>",
  "generatedAt": "2026-08-03T01:50:00.000Z",
  "period": {
    "from": null,
    "to": null
  },
  "overview": {
    "totalLeads": 200,
    "newLeads": 40,
    "convertedLeads": 25,
    "lostLeads": 30,
    "conversionRate": 0.125
  },
  "conversations": {
    "openConversations": 12,
    "closedConversations": 40,
    "messagesSent": 960,
    "messagesReceived": 820
  },
  "followUps": {
    "pending": 48,
    "overdue": 15,
    "executed": 120,
    "executionRate": 0.7143
  },
  "leadsByStatus": {
    "NEW": 40,
    "CONTACTED": 50,
    "RESPONDED": 35,
    "QUALIFIED": 20,
    "CONVERTED": 25,
    "LOST": 30
  }
}
```

`companyId` ecoa `JWT.cid` (transparência; alinhado aos outros módulos).

### Endpoints parciais

Retornam o mesmo sub-objeto + metadados:

```json
{
  "companyId": "...",
  "generatedAt": "...",
  "period": { "from": null, "to": null },
  "overview": { "...": "..." }
}
```

---

## 7. Queries Prisma (esboço)

Sem cache. Preferir `count` / `groupBy` em paralelo (`Promise.all`).

```text
overview:
  lead.count({ companyId, deletedAt: null, createdAt?: range })
  lead.count({ ..., status: NEW })
  lead.count({ ..., status: CONVERTED })
  lead.count({ ..., status: LOST })

conversations:
  conversation.count({ ..., status: OPEN })
  conversation.count({ ..., status: CLOSED })
  message.count({ ..., direction: OUTBOUND })
  message.count({ ..., direction: INBOUND })

followUps:
  followUp.count({ ..., status: in [SUGGESTED, APPROVED, SCHEDULED] })
  followUp.count({ ..., status: in [APPROVED, SCHEDULED], scheduledAt: { lt: now, not: null } })
  followUp.count({ ..., status: EXECUTED })

leadsByStatus:
  lead.groupBy({ by: ['status'], where: { companyId, deletedAt: null, ... }, _count: true })
  → merge com zeros para statuses faltantes
```

Índices existentes já cobrem a maior parte (`companyId+status`, `companyId+createdAt`, `companyId+scheduledAt`, etc.).

---

## 8. Auditoria

**Não** gerar `AuditLog` para leituras de dashboard (somente leitura; alto volume).

---

## 9. Arquitetura proposta (após aprovação)

```text
modules/dashboard/
  dashboard.module.ts
  dashboard.controller.ts
  dashboard.service.ts
  dto/dashboard-query.dto.ts   // from?, to?

Guards: JwtAuthGuard + CompanyContextGuard + RolesGuard
```

Sem migration. Sem dependência de frontend.

---

## 10. Riscos

| Risco | Severidade | Mitigação / gap |
|---|---|---|
| Contagens all-time lentas com crescimento | Média | índices atuais; cache/materialização em fase futura |
| `conversionRate` ambíguo (total vs converted+lost) | Média | definição congelada em §5.1; documentar no Swagger |
| IDLE/ARCHIVED fora de open/closed | Baixa | decisão §11 |
| Overdue vs período | Baixa | overdue = estado atual |
| Tenant Extension off | Aceito | filtro explícito `cid` |
| Sem cache → carga em listagens pesadas | Aceito no MVP | rate-limit futuro no gateway |
| Seeds com phones/`+` mistos não afetam KPIs | — | N/A |

---

## 11. Decisões pedindo aprovação explícita

1. **Shape de routes:** agregado + parciais (**recomendado**) vs só `GET /api/dashboard`  
2. **`conversionRate`:** decimal `0–1` (**recomendado**) vs percentual `0–100`  
3. **`openConversations`:** só `OPEN` (**recomendado**) vs `OPEN+IDLE`  
4. **`closedConversations`:** só `CLOSED` (**recomendado**) vs `CLOSED+ARCHIVED`  
5. **Período `from`/`to`:** incluir nesta fase (**recomendado**, default all-time) vs só all-time  
6. **`overdue` ignora período:** sim (**recomendado**)  
7. **Roles:** OWNER/ADMIN/AGENT todos leem (**recomendado**) vs só OWNER/ADMIN  

---

## 12. Critérios de aceite (implementação futura)

- [ ] Endpoints REST somente leitura sob `/api/dashboard*`  
- [ ] KPIs Overview / Conversations / FollowUps / Leads by Status  
- [ ] Multi-tenant via `JWT.cid`  
- [ ] Soft-delete excluído  
- [ ] Sem cache / sem frontend / sem gráficos  
- [ ] `docs/dashboard-review.md` pós-implementação  

---

## 13. Próximo passo

**Aguardar aprovação** deste design (e das decisões §11).  
Somente após aprovação explícita → implementar código + testes locais + `docs/dashboard-review.md`.
