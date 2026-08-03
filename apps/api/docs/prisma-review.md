# Prisma Review — AutoPilot MVP

**Status:** Schema MVP + pacote **RECOMMENDED (A+B)** aplicado (sem migrations)  
**Arquivo:** `apps/api/prisma/schema.prisma`  
**Fontes:** `domain-model.md`, `domain-decisions.md`, `database-model.md`, `erd.md`, `database-principles.md`, `schema-audit.md`

---

## 1. Tabelas / Models criados

| Model Prisma | Tabela | Tenant |
|---|---|---|
| `Company` | `companies` | raiz |
| `User` | `users` | global |
| `Membership` | `memberships` | `company_id` |
| `Lead` | `leads` | `company_id` |
| `Conversation` | `conversations` | `company_id` |
| `Message` | `messages` | `company_id` |
| `FollowUp` | `follow_ups` | `company_id` |
| `Event` | `events` | `company_id?` |
| `AuditLog` | `audit_logs` | `company_id` |

Campos transversais em todas: `id` (UUID), `created_at`, `updated_at`, `deleted_at?`.

**Não criadas (conforme decisões):** `RecoveryCampaign`, entidade `LeadScore`, qualquer tabela fora do MVP.

---

## 2. Enums criados (8)

| Enum | Valores |
|---|---|
| `CompanyStatus` | `ACTIVE`, `SUSPENDED`, `CLOSED` |
| `UserStatus` | `PENDING`, `ACTIVE`, `DISABLED` |
| `MembershipRole` | `OWNER`, `ADMIN`, `AGENT` |
| `LeadStatus` | `NEW`, `CONTACTED`, `RESPONDED`, `QUALIFIED`, `CONVERTED`, `LOST` |
| `ConversationStatus` | `OPEN`, `IDLE`, `CLOSED`, `ARCHIVED` |
| `Channel` | `WHATSAPP` |
| `MessageDirection` | `INBOUND`, `OUTBOUND` |
| `FollowUpStatus` | `SUGGESTED`, `APPROVED`, `REJECTED`, `SCHEDULED`, `EXECUTING`, `EXECUTED`, `FAILED`, `CANCELLED`, `SKIPPED` |

### Campos String (enums adiados para V2)

| Campo | Default / nota |
|---|---|
| `Membership.status` | default `"INVITED"` |
| `Lead.source` | default `"WHATSAPP"` |
| `Message.status` | obrigatório (sem default) |
| `Message.contentType` | default `"TEXT"` |
| `Message.senderType` | obrigatório |
| `FollowUp.type` | default `"RECOVERY"` |
| `Event.status` | default `"PENDING"` |
| `AuditLog.actorType` | obrigatório |

---

## 3. Índices criados (`@@index`)

| Model | Índices |
|---|---|
| Company | `[status]`, `[slug]` |
| User | `[status]` (+ `@unique` em `email`) |
| Membership | `[companyId]`, `[userId]`, `[companyId, userId]`, `[companyId, role]` |
| Lead | `[companyId, phone]`, `[companyId, status]`, `[companyId, ownerId]`, `[companyId, lastContactAt]`, `[companyId, lastInboundAt]`, `[companyId, score]`, `[companyId, createdAt]`, `[companyId, convertedAt]`, `[companyId, firstResponseAt]` |
| Conversation | `[companyId, leadId]`, `[companyId, status]`, `[companyId, lastMessageAt]`, `[companyId, channel, externalThreadId]` |
| Message | `[conversationId, createdAt]`, `[companyId, createdAt]`, `[companyId, status]`, `[companyId, externalMessageId]` |
| FollowUp | `[companyId, status]`, `[companyId, scheduledAt]`, `[companyId, executedAt]`, `[companyId, leadId]` |
| Event | `[companyId, occurredAt]`, `[companyId, type]`, `[aggregateType, aggregateId]`, `[status]` |
| AuditLog | `[companyId, occurredAt]`, `[companyId, action]`, `[targetType, targetId]`, `[actorUserId]` |

---

## 4. Unique constraints

| Unique | Onde | Motivo |
|---|---|---|
| `User.email` | `@unique` | Entidade global; autenticação futura |

### Sem `@@unique` no schema (por decisão)

Partial unique indexes ficarão para **migrations SQL customizadas**:

- `leads (company_id, phone)` WHERE `deleted_at IS NULL`
- `memberships (company_id, user_id)` WHERE `deleted_at IS NULL`
- `conversations (company_id, channel, external_thread_id)` WHERE … AND `deleted_at IS NULL`
- `messages (company_id, external_message_id)` WHERE … AND `deleted_at IS NULL`
- `companies.slug` — apenas indexado; sem unique

---

## 5. Relacionamentos

```text
User 1─N Membership N─1 Company
Company 1─N Lead | Conversation | Message | FollowUp | Event | AuditLog
Lead 1─N Conversation | FollowUp
Conversation 1─N Message | FollowUp
Message 1─0..1 FollowUp (result_message)
User opcional: Lead.owner, Conversation.assigned,
               Message.sender, FollowUp.assigned/approved_by,
               Membership.invited_by, Event.actor, AuditLog.actor
```

Relações nomeadas no Prisma quando há múltiplas FKs para `User` no mesmo model.

---

## 6. Campos analíticos do Lead (pacote RECOMMENDED)

| Campo | Tipo | Regra de preenchimento (aplicação) |
|---|---|---|
| `convertedAt` | `DateTime?` | Preenchido quando `status` muda para `CONVERTED`. **Nunca** removido automaticamente. |
| `firstResponseAt` | `DateTime?` | Preenchido na **primeira** resposta válida do lead. **Nunca** recalculado depois. |

Índices associados: `[companyId, convertedAt]`, `[companyId, firstResponseAt]`.

**Não aplicados (Patch C rejeitado):** `Conversation.messageCount`, preview de mensagem.

---

## 7. Decisões assumidas no schema

1. UUID via `@default(uuid()) @db.Uuid`
2. Colunas/tabelas mapeadas com `@map` / `@@map` em `snake_case`
3. `Json` / `Json?` para metadata/payload/before/after
4. `Event.companyId` opcional
5. `Company.slug` nullable + index, sem unique
6. Enums V2 como `String` com defaults documentados
7. `User.email` com `@unique` (exceção aprovada)
8. Sem `@@unique` de negócio em Lead/Membership/Conversation/Message
9. CHECK `score 0–100` e regra FollowUp `EXECUTED ⇒ approved_by` **não** expressos no Prisma (app layer)
10. Soft delete presente; middleware Prisma de filtro automático **não** implementado nesta etapa
11. Pacote audit **RECOMMENDED (A+B)** aplicado; Patch C não aplicado

---

## 8. Possíveis riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Sem partial unique ainda | Duplicatas de phone/membership possíveis até migration SQL | Enforce na aplicação + migration customizada logo após approve |
| `User.email @unique` + soft delete | Reuso do mesmo e-mail após soft delete falha | Política: anonymizar e-mail no soft delete, ou unique parcial na migration |
| Strings no lugar de enums V2 | Valores inválidos no DB | Validação Zod/class-validator nos DTOs |
| `Message.status` sem default | Inserts incompletos quebram | Factory/serviço define status por direção |
| Cross-tenant FK consistency | App pode apontar lead de outra company | Validar `company_id` igual em todos os writes |
| Event/AuditLog soft delete | Contradiz append-only ideal | Usar soft delete só em casos legais; preferir retenção |
| Score sem CHECK no DB | Score fora 0–100 | Validar na aplicação |
| `convertedAt` / `firstResponseAt` só na app | Esquecer de setar corrompe métricas | Serviços de domínio + testes; nunca limpar automaticamente |

---

## 9. Fora desta etapa

- Migrations (`prisma migrate`)
- Partial unique indexes SQL
- Seed scripts (estratégia em `seed-strategy.md`; implementação futura)
- Repositories / services / CRUDs
- Prisma middleware de soft delete / tenancy
- Patch C (inbox denormalizado)

---

## 10. Próximos passos sugeridos

1. Aprovar schema pós-RECOMMENDED
2. Criar migration inicial a partir do schema
3. Adicionar SQL customizado de partial uniques
4. Implementar seeds conforme `seed-strategy.md`
5. Middleware Prisma: soft delete + tenant scope
6. Na app: regras de escrita de `convertedAt` e `firstResponseAt`
