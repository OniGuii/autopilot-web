# Follow-Ups Design — Follow-Up Engine MVP

**Status:** Design para aprovação (**sem implementação**)  
**Fase:** 5 — Follow-Up Engine MVP  
**Pré-requisitos:** Auth + Leads + Conversations  
**Referências:** `domain-decisions.md` (D3 híbrido, D7, D9, D10), `domain-model.md` (§5.7), `schema.prisma` (`FollowUp`, `Message`, `AuditLog`), `conversations-review.md`

---

## 1. Objetivo

Implementar o núcleo de recuperação: sugerir → aprovar/rejeitar → executar manualmente um Follow-Up, gerando Message OUTBOUND **sem** enviar WhatsApp nesta fase.

**Fora deste MVP (não implementar):**
- WhatsApp / Evolution / webhooks  
- IA (geração de texto)  
- n8n / workers / filas  
- Agendamento automático (cron/job que dispara sozinho)  
- Dashboard  
- DELETE de FollowUp  
- Ativação global da Prisma Tenant Extension  

---

## 2. Entidades e pertencimento

```text
Company
  └── Lead
        ├── Conversation?  (opcional no FollowUp)
        └── FollowUp
              └── Message?  (resultMessage — criada no EXECUTE)
```

| Entidade | Pertence a | Obrigatório |
|---|---|---|
| FollowUp | Company | sim (`JWT.cid`) |
| FollowUp | Lead | sim |
| FollowUp | Conversation | **opcional** no create; **obrigatório para execute** (proposta) |
| FollowUp | Message (`resultMessageId`) | preenchido no execute |

### 2.1 Campos relevantes (`follow_ups` — schema existente)

| Campo API | DB | Create | Update | Notas |
|---|---|---|---|---|
| — | `company_id` | server | imutável | `JWT.cid` |
| `leadId` | `lead_id` | **obrigatório** | imutável | Lead ativo da company |
| `conversationId` | `conversation_id` | opcional | opcional* | Conversation ativa da mesma company + mesmo lead |
| `assignedUserId` | `assigned_user_id` | opcional | opcional | Membership ACTIVE; default `null` |
| `suggestedBody` | `suggested_body` | **obrigatório** | opcional (só SUGGESTED) | texto da sugestão |
| `type` | `type` | opcional | opcional | default `RECOVERY` |
| `channel` | `channel` | opcional | — | default `WHATSAPP` (único canal MVP) |
| `scheduledAt` | `scheduled_at` | opcional | opcional | ISO datetime |
| `status` | `status` | server | via actions | default `SUGGESTED` |
| — | `approved_by` / `approved_at` | server | approve | |
| — | `executed_at` / `result_message_id` | server | execute | |
| `cancelReason` | `cancel_reason` | — | reject | motivo da rejeição |

\* PATCH não muda `leadId`/`companyId`. `conversationId` só mutável enquanto status ∈ {`SUGGESTED`,`APPROVED`,`SCHEDULED`}.

---

## 3. Fluxo de estados (MVP)

Enum completo no schema inclui estados extras (`EXECUTING`, `FAILED`, `CANCELLED`, `SKIPPED`).  
**Neste MVP a API só transita nos estados abaixo.**

```text
                 ┌────────────┐
                 │ SUGGESTED  │  ← create
                 └─────┬──────┘
           approve │   │ reject
                   ▼   ▼
            ┌──────────┐   ┌──────────┐
            │ APPROVED │   │ REJECTED │  (terminal)
            └─────┬────┘   └──────────┘
                  │ schedule (implícito / PATCH)
                  ▼
            ┌───────────┐
            │ SCHEDULED │
            └─────┬─────┘
                  │ execute (manual)
                  ▼
            ┌──────────┐
            │ EXECUTED │  (terminal)
            └──────────┘
```

### Transições permitidas

| De | Ação | Para | Side-effects |
|---|---|---|---|
| — | `POST` create | `SUGGESTED` | audit `FOLLOWUP_CREATE` |
| `SUGGESTED` | `POST .../approve` | `APPROVED` → em seguida `SCHEDULED`* | `approvedBy=sub`, `approvedAt=now`; se `scheduledAt` null → `scheduledAt=now`; audit `FOLLOWUP_APPROVE` |
| `SUGGESTED` | `POST .../reject` | `REJECTED` | `cancelReason` opcional/obrigatório (decisão §14); audit `FOLLOWUP_REJECT` |
| `APPROVED` / `SCHEDULED` | `POST .../execute` | `EXECUTED` | cria Message OUTBOUND; `resultMessageId`; `executedAt=now`; `lastMessageAt` na Conversation; audit `FOLLOWUP_EXECUTE` (+ `MESSAGE_CREATE` na mesma tx) |
| `SUGGESTED` / `APPROVED` / `SCHEDULED` | `PATCH` | mesmos status (campos editáveis) | **sem** audit de PATCH nesta fase (decisão §14) — ou `FOLLOWUP_UPDATE` se aprovado |

\* **Proposta de approve (recomendada):** em uma única ação de approve o status final fica `SCHEDULED` (passando logicamente por APPROVED: grava `approvedBy`/`approvedAt` e já deixa pronto para execute). Assim o fluxo do produto “sugerido → aprovado → agendado” fica materializado sem endpoint extra de schedule.  
Alternativa: approve para em `APPROVED` e execute aceita `APPROVED|SCHEDULED`.

Estados **não usados** pela API nesta fase: `EXECUTING`, `FAILED`, `CANCELLED`, `SKIPPED` (reservados WhatsApp/jobs futuros).

---

## 4. Endpoints

Prefixo global: `api`.  
Path oficial proposto: **`/api/follow-ups`** (plural; o scaffold atual `follow-up` será alinhado).

| Método | Path | Auth | Descrição |
|---|---|---|---|
| `POST` | `/api/follow-ups` | Bearer + company + role | Criar sugestão (`SUGGESTED`) |
| `GET` | `/api/follow-ups` | Bearer + company + role | Listar + filtros + paginação |
| `GET` | `/api/follow-ups/:id` | Bearer + company + role | Detalhe |
| `PATCH` | `/api/follow-ups/:id` | Bearer + company + role | Editar campos permitidos |
| `POST` | `/api/follow-ups/:id/approve` | Bearer + company + role | Aprovar |
| `POST` | `/api/follow-ups/:id/reject` | Bearer + company + role | Rejeitar |
| `POST` | `/api/follow-ups/:id/execute` | Bearer + company + role | Executar manualmente |

Guards (padrão Leads/Conversations):
1. `JwtAuthGuard`
2. `CompanyContextGuard`
3. `RolesGuard` → **`OWNER` \| `ADMIN` \| `AGENT`**

Sem RBAC fino por ação no MVP.

---

## 5. Multi-tenancy & cross-tenant

```text
companyId = JWT.cid
```

| Regra | Detalhe |
|---|---|
| Derivação | Todo create/list/get/patch/action usa `cid` |
| Body | `companyId` do cliente → **400** |
| Lead | `leadId` deve existir com `companyId=cid` e `deletedAt=null` → senão **404** |
| Conversation | se informada: `id + companyId=cid + leadId=followUp.leadId + deletedAt=null` → senão **404** |
| Isolation | `WHERE companyId = cid AND deletedAt IS NULL` |
| Cross-tenant | **404** (não vazar existência) |

---

## 6. Contratos

### `POST /api/follow-ups`

```json
{
  "leadId": "<uuid>",
  "conversationId": "<uuid|null>",
  "suggestedBody": "Oi! Vi que você se interessou pelo Civic. Posso te ajudar?",
  "type": "RECOVERY",
  "scheduledAt": null,
  "assignedUserId": null
}
```

**Response:** `201` + FollowUp (`companyId` presente, `status=SUGGESTED`)

### `GET /api/follow-ups`

| Query | Tipo | Default | Descrição |
|---|---|---|---|
| `status` | FollowUpStatus (subset MVP) | — | filtro exato |
| `leadId` | UUID | — | |
| `assignedUserId` | UUID | — | |
| `scheduledFrom` | ISO datetime | — | `scheduledAt >=` |
| `scheduledTo` | ISO datetime | — | `scheduledAt <=` |
| `page` | int ≥ 1 | `1` | |
| `limit` | int 1–100 | `20` | |

Ordenação proposta: `scheduledAt ASC NULLS LAST`, depois `createdAt DESC` (**decidir §14**).

**Response:** `{ data, meta }` — cada item com `companyId`; opcional embed `lead: { id, name, phone }`.

### `GET /api/follow-ups/:id`

FollowUp completo + resumos:
- `lead: { id, name, phone }`
- `conversation: { id, status } | null`
- `resultMessage: { id, body, direction, sentAt } | null`

### `PATCH /api/follow-ups/:id`

Mutável conforme status:

| Campo | SUGGESTED | APPROVED/SCHEDULED | REJECTED/EXECUTED |
|---|---|---|---|
| `suggestedBody` | sim | não | não |
| `scheduledAt` | sim | sim | não |
| `assignedUserId` | sim | sim | não |
| `conversationId` | sim | sim | não |
| `type` | sim | não | não |

### `POST /api/follow-ups/:id/approve`

Body opcional:
```json
{ "scheduledAt": "2026-08-03T15:00:00.000Z" }
```

Só de `SUGGESTED`.  
Grava aprovação e deixa status em `SCHEDULED` (proposta §3).

### `POST /api/follow-ups/:id/reject`

```json
{ "reason": "Mensagem inadequada" }
```

Só de `SUGGESTED` → `REJECTED`.  
`reason` → `cancelReason` (max 500).

### `POST /api/follow-ups/:id/execute`

Body vazio (ou opcional override de body — **não** nesta fase; usa `suggestedBody`).

Pré-condições:
1. status ∈ {`APPROVED`,`SCHEDULED`} (ou só `SCHEDULED` se approve já materializa SCHEDULED)
2. `conversationId` presente e válido
3. `suggestedBody` não vazio

Efeitos (mesma `$transaction`):
1. Criar `Message` OUTBOUND na Conversation (`body = suggestedBody`, defaults Conversations MVP)
2. Atualizar `Conversation.lastMessageAt`
3. FollowUp → `EXECUTED`, `executedAt=now()`, `resultMessageId=message.id`
4. Audits: `FOLLOWUP_EXECUTE` + `MESSAGE_CREATE` (reutilizar padrão Conversations)
5. **Não** chamar WhatsApp / Evolution

---

## 7. Execução manual vs WhatsApp futuro

### Agora (Fase 5)

```text
execute
  → Message OUTBOUND (persistida)
  → status EXECUTED
  → Audit
  → (sem envio externo)
```

### Futuro (integração WhatsApp)

```text
execute / job
  → status EXECUTING
  → Evolution/WhatsApp send
  → success → EXECUTED + externalMessageId
  → failure → FAILED + motivo
```

A Message criada nesta fase permanece a fonte do `body`; o envio externo só adiciona ids/status de entrega.  
Nenhuma mudança de contrato público é necessária além de campos opcionais futuros (`externalMessageId`, etc.).

---

## 8. Auditoria

Sempre na **mesma transação** da mutação.

| Ação API | `action` | `targetType` |
|---|---|---|
| create | `FOLLOWUP_CREATE` | `FOLLOWUP` |
| approve | `FOLLOWUP_APPROVE` | `FOLLOWUP` |
| reject | `FOLLOWUP_REJECT` | `FOLLOWUP` |
| execute | `FOLLOWUP_EXECUTE` | `FOLLOWUP` |
| execute (msg) | `MESSAGE_CREATE` | `MESSAGE` |

Campos: `companyId=cid`, `actorType=USER`, `actorUserId=sub`, `before`/`after` snapshot.  
Snapshot FollowUp: `id, companyId, leadId, conversationId, status, type, suggestedBody (≤2000), scheduledAt, assignedUserId, approvedBy, executedAt, resultMessageId, cancelReason`.  
`GET` / (PATCH se sem audit) não geram log.

---

## 9. Arquitetura proposta (após aprovação)

```text
modules/follow-up/   (ou renomear pasta para follow-ups — manter módulo Nest)
  follow-up.module.ts
  follow-up.controller.ts   @Controller('follow-ups')
  follow-up.service.ts
  dto/
    create-follow-up.dto.ts
    update-follow-up.dto.ts
    list-follow-ups.query.dto.ts
    approve-follow-up.dto.ts
    reject-follow-up.dto.ts

Reusa:
  AuditService
  JwtAuthGuard + CompanyContextGuard + RolesGuard
  ConversationsService? (opcional) ou Prisma direto para Message
```

Preferência MVP: **Prisma direto** no `FollowUpService` para Message + `lastMessageAt` (mesmos defaults de Conversations), evitando acoplamento circular. Extrair helper compartilhado de “create outbound message” só se necessário.

Sem migration nova.

---

## 10. Segurança

| Controle | Como |
|---|---|
| AuthN | Bearer JWT |
| Tenant | `cid` em todas as queries |
| Roles | OWNER / ADMIN / AGENT |
| Mass assignment | DTO whitelist |
| IDOR | 404 cross-tenant |
| Execute sem conversation | 400 |
| Transição inválida | 409 Conflict |

---

## 11. Riscos

| Risco | Severidade | Mitigação / gap |
|---|---|---|
| Execute sem WhatsApp gera falsa sensação de “enviado” | Média | Documentar na API/Swagger: persistência local only; UI deve rotular “registrado” vs “enviado” |
| Conversation opcional no create mas obrigatória no execute | Baixa | PATCH conversationId antes; 400 claro |
| Estados extras no enum não usados | Baixa | Aceito; jobs futuros |
| Sem job de schedule | Aceito | `SCHEDULED` é staging manual |
| Race double-execute | Média | update condicional `WHERE status IN (...)` + 409 |
| Tenant Extension off | Aceito | isolamento app-layer |
| PATCH sem audit | Baixa | decisão §14 |

---

## 12. Exemplos de erro

| Caso | HTTP |
|---|---|
| Sem token / inválido | 401 |
| Sem company context / role | 403 |
| Validação / `companyId` no body | 400 |
| Lead/FollowUp/Conversation outra company | 404 |
| approve/reject/execute em status inválido | 409 |
| execute sem `conversationId` | 400 |

---

## 13. Critérios de aceite (implementação futura)

- [ ] CRUD parcial: create/list/get/patch  
- [ ] approve / reject / execute  
- [ ] Fluxo SUGGESTED → APPROVED/SCHEDULED → EXECUTED ou REJECTED  
- [ ] Execute cria Message OUTBOUND + `EXECUTED` + audits (sem WhatsApp)  
- [ ] Multi-tenancy `JWT.cid`  
- [ ] Filtros status/leadId/assignedUserId/scheduledFrom/scheduledTo  
- [ ] `docs/followups-review.md`  

---

## 14. Decisões pedindo aprovação explícita

1. **Approve materializa `SCHEDULED` imediatamente** (recomendado) vs fica em `APPROVED` e execute aceita ambos  
2. **`reject.reason`:** obrigatório (recomendado) vs opcional  
3. **Ordenação list:** `scheduledAt ASC NULLS LAST, createdAt DESC` (recomendado) vs `createdAt DESC`  
4. **PATCH gera `FOLLOWUP_UPDATE`?** não nesta fase (recomendado) vs sim  
5. **Execute sem conversationId:** 400 (recomendado) vs auto-criar Conversation  
6. **Path:** `/api/follow-ups` (pedido) — confirmar (vs scaffold `follow-up`)  
7. **`companyId` nas responses:** sim (recomendado, alinhado Leads/Conversations)  

---

## 15. Próximo passo

**Aguardar aprovação** deste design (e das decisões §14).  
Somente após aprovação explícita → implementar código + testes locais + `docs/followups-review.md`.
