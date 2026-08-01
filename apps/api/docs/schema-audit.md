# Schema Audit — AutoPilot MVP

**Status:** Auditoria (sem alteração de `schema.prisma`)  
**Alvo:** `apps/api/prisma/schema.prisma`  
**Objetivo:** Validar se o schema sustenta os casos de uso do MVP sem refatoração imediata.

**Veredito geral:**

> O schema **suporta o MVP** para os fluxos principais (leads, conversas, follow-up híbrido, tenancy).  
> Existem **gaps de índice e 2–3 campos derivados** que não bloqueiam o go-live do modelo, mas devem ser corrigidos **antes ou na primeira migration** para evitar dor em dashboard, recuperação e escala ~100k leads.

---

## 1. Fluxo de recuperação de leads

| Caso de uso | Suporte | Evidência no schema | Lacuna |
|---|---|---|---|
| Listar leads da company | ✅ | `companyId` em todos os índices compostos de `Lead` | Sempre filtrar `deletedAt: null` na app |
| Filtrar por status | ✅ | `@@index([companyId, status])` + enum `LeadStatus` | — |
| Filtrar por responsável | ✅ | `ownerId` + `@@index([companyId, ownerId])` | `ownerId` opcional → fila “sem dono” ok |
| Filtrar por data de contato | ✅ | `lastContactAt` + `@@index([companyId, lastContactAt])` | — |
| Filtrar por data de criação | ⚠️ | `createdAt` existe | **Sem** `@@index([companyId, createdAt])` |
| Filtrar por score | ✅ | `score` + `@@index([companyId, score])` | CHECK 0–100 só na app |
| Leads “sem resposta” / recovery | ⚠️ | `lastInboundAt`, `lastOutboundAt`, `status` | **Sem índice** em `lastInboundAt` / `lastOutboundAt` |
| Busca por telefone | ✅ | `@@index([companyId, phone])` | Unique parcial ainda não no DB |
| Busca por nome | ⚠️ | `name` existe | Sem índice/`pg_trgm` (ok no MVP se busca for secundária) |

### Conclusão — Leads
Fluxos de lista/filtro do MVP estão cobertos.  
O caso **central do produto** (recovery por ausência de resposta) fica mais frágil sem índice em `last_inbound_at` / `last_outbound_at`.

---

## 2. Fluxo de conversas

| Caso de uso | Suporte | Evidência | Lacuna |
|---|---|---|---|
| Última mensagem (ordenação inbox) | ✅ | `Conversation.lastMessageAt` + `@@index([companyId, lastMessageAt])` | App deve manter o campo atualizado a cada message |
| Preview da última mensagem | ❌ | — | Campo ausente (`lastMessagePreview` / `lastMessageId`) |
| Quantidade de mensagens | ⚠️ | Relação `messages` + `_count` Prisma | Sem `messageCount` denormalizado → custo em listas |
| Conversa ativa | ✅ | `status = OPEN` + `@@index([companyId, status])` | — |
| Conversa idle | ✅ | `status = IDLE` | Critério idle é app/job (ok) |
| Conversa arquivada / fechada | ✅ | `ARCHIVED` / `CLOSED` | — |
| Histórico ordenado | ✅ | `@@index([conversationId, createdAt])` em `Message` | — |
| Idempotência webhook | ⚠️ | index `[companyId, externalMessageId]` | Unique parcial pendente |

### Conclusão — Conversas
Inbox e thread funcionam.  
Listagens com **contagem** e **preview** vão exigir `_count`/join ou campos denormalizados — aceitável no MVP inicial, problema em escala.

---

## 3. Fluxo de follow-up

| Caso de uso | Suporte | Evidência | Lacuna |
|---|---|---|---|
| Pendentes de aprovação (`SUGGESTED`) | ✅ | `FollowUpStatus` + `@@index([companyId, status])` | — |
| Aprovados (`APPROVED`) | ✅ | idem | — |
| Agendados / fila de envio | ⚠️ | `scheduledAt` + index `[companyId, scheduledAt]` | Falta composto `[companyId, status, scheduledAt]` para due-queue |
| Executados (`EXECUTED`) | ✅ | status indexado; `executedAt` existe | **`executedAt` sem índice** (dashboard por período) |
| Falhados (`FAILED`) | ✅ | status | — |
| Fluxo híbrido D3 | ✅ | `approvedBy`, `approvedAt`, `suggestedBody`, `resultMessageId` | Regra EXECUTED⇒approvedBy só na app |
| Por lead | ✅ | `@@index([companyId, leadId])` | — |

### Conclusão — Follow-up
Máquina de estados híbrida está bem modelada.  
Filas operacionais e métricas por `executed_at` pedem 1–2 índices adicionais.

---

## 4. Dashboard

| Métrica MVP | Suporte | Como calcular hoje | Lacuna |
|---|---|---|---|
| Leads por status | ✅ | `GROUP BY status` com `companyId` + index status | Filtrar soft delete |
| Conversões | ⚠️ | `COUNT` onde `status = CONVERTED` | Sem `convertedAt` → tendência temporal usa `updatedAt` (impreciso) |
| Follow-ups executados | ⚠️ | `status = EXECUTED` | Filtro por período em `executedAt` sem índice |
| Tempo médio de resposta | ❌/⚠️ | Inferir via pares INBOUND→OUTBOUND em `messages` | Sem `firstResponseAt` no Lead; query cara |
| Leads sem resposta | ⚠️ | `lastInboundAt` / gap outbound | Índices ausentes (ver §1) |
| Funil NEW→CONVERTED | ✅ | agregação por status | — |

### Conclusão — Dashboard
3 de 4 métricas “de cartão” são viáveis.  
**Tempo médio de resposta** é o maior buraco analítico do schema atual.

---

## 5. Multi-tenancy

### Pontos fortes
- `companyId` presente em todas as entidades de negócio (User é global — D10).
- Índices principais são **tenant-aware** (prefixo `companyId`).
- Membership com `[companyId, userId]` e `[companyId, role]` para authz.

### Riscos de vazamento

| Risco | Severidade | Notas |
|---|---|---|
| Esquecer `companyId` na query | **Alta** | Sem RLS no Postgres; só disciplina de app/`TenantGuard` |
| FK cross-tenant (ex.: `conversation.leadId` de outra company) | **Alta** | Prisma/Postgres **não** validam igualdade de `company_id` entre FKs |
| `Event.companyId` opcional | **Média** | Eventos `null` podem vazar em listagens mal filtradas |
| Soft-deleted membership ainda legível | **Média** | Auth deve exigir membership `ACTIVE` + `deletedAt null` |
| Unique parcial ausente | **Média** | Duplicatas de phone confundem tenancy operacional |

### Índices tenant-aware — cobertura

| Tabela | Tenant prefix nos índices? |
|---|---|
| leads | ✅ |
| conversations | ✅ |
| messages | ✅ (exceto `[conversationId, createdAt]` — ok, conversation já isola) |
| follow_ups | ✅ |
| events | ✅ (quando `companyId` não null) |
| audit_logs | ✅ |
| memberships | ✅ |

### Conclusão — Tenancy
Modelo está correto. Segurança depende 100% da camada de aplicação até existir RLS (pós-MVP ok).

---

## 6. Soft delete

### Impacto em consultas
- Toda listagem precisa `deletedAt: null` (middleware Prisma recomendado).
- Aggregations de dashboard incham se esquecer o filtro.
- Relacionamentos podem retornar filhos soft-deleted sem filtro explícito.

### Impacto em performance
- Linhas soft-deleted continuam nos índices atuais (Prisma não gera partial indexes).
- Com o tempo, inbox/recovery degradam se o volume deletado crescer.
- Mitigação futura: índices `WHERE deleted_at IS NULL` na migration SQL.

### Impacto em unicidade
- Já decidido: sem `@@unique` de negócio; partial unique depois.
- `User.email @unique` **bloqueia** recriação do mesmo e-mail após soft delete.

### Conclusão — Soft delete
Adequado ao princípio do produto.  
Exige middleware + partial indexes na fase de migration.

---

## 7. Prisma — gaps técnicos

### 7.1 Índices ausentes (recomendados)

| Prioridade | Índice sugerido | Motivo |
|---|---|---|
| P0 | `Lead @@index([companyId, createdAt])` | Filtro/dashboard por período |
| P0 | `Lead @@index([companyId, lastInboundAt])` | Recovery “sem resposta” |
| P1 | `Lead @@index([companyId, lastOutboundAt])` | SLA de follow-up outbound |
| P0 | `FollowUp @@index([companyId, executedAt])` | Dashboard / relatórios |
| P1 | `FollowUp @@index([companyId, status, scheduledAt])` | Fila due híbrida |
| P2 | `Membership @@index([companyId, status])` | Listar membros ativos (status é String) |
| P2 | `Message @@index([companyId, direction, createdAt])` | Métricas de resposta |

### 7.2 Campos ausentes (não inventar regra — só derivados operacionais)

| Prioridade | Campo sugerido | Model | Motivo |
|---|---|---|---|
| P1 | `convertedAt DateTime?` | Lead | Conversões no tempo (D2) sem abusar de `updatedAt` |
| P1 | `firstResponseAt DateTime?` | Lead | Tempo médio de resposta no dashboard |
| P2 | `messageCount Int @default(0)` | Conversation | Evitar `_count` em listagens |
| P3 | `lastMessageId` ou `lastMessagePreview` | Conversation | Inbox UX |
| P3 | `failedReason` / já existe `cancelReason` | FollowUp | Falhas de envio — `cancelReason` pode reutilizar; avaliar `failureReason` depois |

> Campos P1/P2 são **operacionais**, não novas entidades de domínio. Ainda assim: **só aplicar com aprovação**.

### 7.3 Relacionamentos ausentes
- Nenhum relacionamento obrigatório do ERD está faltando.
- Message→Lead é indireto via Conversation (**correto**, D9).
- Event/AuditLog polimórficos por `aggregate_*` / `target_*` (**correto**).

### 7.4 Outros
- Sem `onDelete` explícito (default RESTRICT/NoAction) — adequado com soft delete.
- Enums V2 como String: risco de valor inválido (validar na app).

---

## 8. Escalabilidade (> 100 mil leads)

| Ponto de pressão | Risco | Por quê | Mitigação |
|---|---|---|---|
| Lista de conversas com `_count` messages | **Alto** | Aggregate por row | `messageCount` denormalizado |
| Recovery scan sem índice em `last_inbound_at` | **Alto** | Seq scan por tenant grande | Índice P0 |
| Dashboard tempo de resposta via messages | **Alto** | Janela grande de rows | `firstResponseAt` no Lead |
| `events` / `audit_logs` unbounded | **Médio** | Append-only cresce rápido | Particionamento/retenção V2; arquivar |
| Partial unique ausente | **Médio** | Duplicatas operacionais | SQL na migration |
| JSON `metadata`/`payload` grandes | **Médio** | TOAST + I/O | Limitar tamanho na app |
| Soft delete acumulado | **Médio** | Índices “sujos” | Partial indexes |
| Hot company (1 tenant enorme) | **Médio** | Todos os índices são por company — ainda ok até centenas de k com filtros seletivos | Monitorar; read replicas depois |
| N+1 Prisma em inbox | **Alto (app)** | Não é schema, mas quebra UX | `include` seletivo + denormalização |

### Conclusão — Escala
Para MVP com poucos tenants/milhares de leads: **ok**.  
Para 100k+ leads **por company**: precisa dos índices P0 e preferencialmente `convertedAt` / `firstResponseAt` / `messageCount` antes de tráfego real.

---

## 9. Matriz de prontidão MVP

| Fluxo | Pronto sem mudança? | Refatoração imediata necessária? |
|---|---|---|
| Recuperação de leads (CRUD/filtros básicos) | ✅ Sim | Não |
| Recuperação “sem resposta” em escala | ⚠️ Parcial | Índices (não remodelagem) |
| Conversas / WhatsApp thread | ✅ Sim | Não |
| Inbox com count/preview | ⚠️ Parcial | Campos opcionais |
| Follow-up híbrido | ✅ Sim | Índices auxiliares |
| Dashboard básico (status/conversões/follow-ups) | ⚠️ Parcial | `convertedAt` + index `executedAt` |
| Dashboard tempo de resposta | ❌ Frágil | `firstResponseAt` ou job analítico |
| Multi-tenancy estrutural | ✅ Sim | Guard/RLS na app |
| Soft delete | ✅ Sim | Middleware + partial indexes |

**Resposta à pergunta da auditoria:**  
O schema **não exige refatoração estrutural** (tabelas/relações).  
Exige **ajustes leves (índices + poucos campos derivados)** para fechar dashboard/recovery sem retrabalho cedo.

---

## 10. Recomendações

### Antes da migration (altamente recomendado)
1. Adicionar índices P0: `Lead(companyId, createdAt)`, `Lead(companyId, lastInboundAt)`, `FollowUp(companyId, executedAt)`.
2. Adicionar `Lead.convertedAt` e `Lead.firstResponseAt` (nullable).
3. Planejar no SQL da migration: partial uniques (já decidido) + partial indexes `WHERE deleted_at IS NULL` nos caminhos quentes.

### Pode esperar (MVP early)
4. `Conversation.messageCount` / preview.
5. Índice composto follow-up `(companyId, status, scheduledAt)`.
6. RLS Postgres.
7. Particionamento de `events` / `audit_logs`.

### Disciplina de aplicação (obrigatória mesmo sem mudar schema)
8. Middleware Prisma: filtro global `deletedAt: null`.
9. `TenantGuard`: todo where com `companyId` do contexto.
10. Validar mesma `companyId` em writes compostos (Lead↔Conversation↔Message↔FollowUp).
11. Manter `lastMessageAt` / futuros campos derivados sincronizados em transação com Message.

---

## 11. Correções sugeridas (para aprovação — ainda **não** aplicadas)

### Patch A — Índices P0
```prisma
// Lead
@@index([companyId, createdAt])
@@index([companyId, lastInboundAt])

// FollowUp
@@index([companyId, executedAt])
```

### Patch B — Campos analíticos P1
```prisma
// Lead
convertedAt     DateTime? @map("converted_at") @db.Timestamptz(6)
firstResponseAt DateTime? @map("first_response_at") @db.Timestamptz(6)

@@index([companyId, convertedAt])
@@index([companyId, firstResponseAt])
```

### Patch C — Inbox P2 (opcional MVP)
```prisma
// Conversation
messageCount       Int     @default(0) @map("message_count")
lastMessagePreview String? @map("last_message_preview") @db.VarChar(280)
```

### Patch D — Migration SQL (não Prisma)
- Partial uniques já listadas em `prisma-review.md`
- Partial indexes espelhando os compostos quentes com `WHERE deleted_at IS NULL`

---

## 12. Decisão solicitada

Escolher um pacote antes da migration:

| Pacote | Conteúdo | Recomendação |
|---|---|---|
| **Minimal** | Só Patch A (índices) | Aceitável |
| **Recommended** | Patch A + B | **Recomendado** |
| **Full MVP inbox** | A + B + C | Se inbox for tela crítica no dia 1 |

---

## 13. Fora de escopo desta auditoria

- Alterar `schema.prisma` (aguardando aprovação)
- Criar migrations
- Implementar middleware/seeds/CRUD

---

**Aguardo aprovação do pacote de correções (Minimal / Recommended / Full) antes de qualquer mudança no schema ou migrations.**
