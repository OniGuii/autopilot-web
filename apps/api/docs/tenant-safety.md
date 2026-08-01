# Tenant Safety — AutoPilot MVP

**Status:** Análise + guard rails documentados (extensions ainda **não** ativadas)  
**Objetivo:** Proteger isolamento multi-tenant antes do Auth  
**Relacionados:** `database-validation.md`, `domain-decisions.md` (D8/D10), `prisma-extensions.md`

---

## 1. Modelo de isolamento

```text
Request → (futuro Auth) → Membership ACTIVE → companyId
         → TenantContext
         → Prisma queries SEMPRE filtradas por companyId
         → Soft delete: deletedAt IS NULL
```

| Entidade | Tenant? | Regra |
|---|---|---|
| `User` | Não (global) | Acesso a dados só via `Membership` |
| `Company` | Raiz | Isola todos os dados filhos |
| Demais tabelas de negócio | Sim | `company_id` obrigatório (Event pode ser null — raro) |

O banco **garante** FK para `companies.id`.  
O banco **não garante** que `conversation.company_id = lead.company_id`.

---

## 2. Cenários de vazamento

| ID | Cenário | Vetor | Impacto |
|---|---|---|---|
| V1 | Query sem `companyId` | `prisma.lead.findMany()` | Lista leads de todos os tenants |
| V2 | `companyId` do body/client | Cliente envia outra company | Leitura/escrita cross-tenant |
| V3 | FK cruzada | Conversation com `leadId` de company A e `companyId` B | Histórico/mensagens misturados |
| V4 | Message desnormalizada inconsistente | `message.companyId` ≠ `conversation.companyId` | Relatórios/inbox vazam |
| V5 | FollowUp apontando lead de outro tenant | IDs manipulados | Ações de recovery no tenant errado |
| V6 | Soft-deleted membership ainda usada | Token antigo / cache | Acesso após revogação |
| V7 | Soft-deleted rows em listagens | Sem filtro `deletedAt` | Dados “apagados” reaparecem |
| V8 | Event com `companyId` null listado globalmente | Dashboard admin mal escrito | Metadados cross-tenant |
| V9 | User global sem checar Membership | Auth futuro só valida user | User de A acessa company B |
| V10 | Seed/ops script sem tenant | Job interno | Contaminação acidental |

---

## 3. Cenários inválidos (devem ser rejeitados)

1. Criar `Lead` sem `companyId`
2. Criar `Message` sem `conversationId` ou com conversation de outra company
3. Criar `Conversation` cujo `lead.companyId` ≠ `conversation.companyId`
4. Criar `FollowUp` com `leadId`/`conversationId`/`resultMessageId` de companies distintas
5. Membership duplicada ativa `(companyId, userId)` — bloqueada por M2 após migrate
6. Phone duplicado ativo na mesma company — bloqueado por M2
7. Operação de negócio com Membership `INVITED` / `REVOKED` / soft-deleted
8. Hard delete de Message/Lead/Company na aplicação
9. IA/sistema alterando `companyId` de registros existentes
10. Troca de `companyId` em update (imutável após create)

---

## 4. Validações necessárias

### 4.1 Camada request (futuro Auth — não nesta etapa)

| Validação | Onde |
|---|---|
| Resolver `userId` autenticado | Auth guard |
| Resolver `companyId` ativo (header/subdomínio/membership) | `TenantContext` / interceptor |
| Membership `ACTIVE` + `deletedAt null` + role | `TenantGuard` |
| Falhar fechado se company ausente | Guard |

### 4.2 Camada domínio / serviços

| Validação | Quando |
|---|---|
| `assertSameTenant(ctx.companyId, input.companyId)` | Todo write |
| Carregar lead/conversation e comparar `companyId` | Antes de create message/follow-up |
| Impedir update de `companyId` | Policies de update |
| Setar `convertedAt` / `firstResponseAt` só no tenant correto | Lead service |

### 4.3 Camada Prisma (extensions — scaffold agora)

| Validação | Extension |
|---|---|
| Injetar / exigir `companyId` em finds | `tenant.extension` |
| Rejeitar where cross-tenant | `tenant.extension` |
| Default `deletedAt: null` | `soft-delete.extension` |
| `delete` → soft delete | `soft-delete.extension` |

### 4.4 Camada SQL / inspeção (ops)

```sql
-- Deve retornar 0 rows
SELECT c.id
FROM conversations c
JOIN leads l ON l.id = c.lead_id
WHERE c.company_id <> l.company_id;

SELECT m.id
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
WHERE m.company_id <> c.company_id;
```

---

## 5. Estratégia de isolamento (camadas)

```text
┌─────────────────────────────────────────┐
│ 1. Auth + Membership (futuro)           │  quem é e qual company
├─────────────────────────────────────────┤
│ 2. TenantContext / Guard                │  companyId no request
├─────────────────────────────────────────┤
│ 3. Domain asserts (assertSameTenant)    │  validação explícita
├─────────────────────────────────────────┤
│ 4. Prisma Extensions (a ativar)         │  filtro automático
├─────────────────────────────────────────┤
│ 5. Partial uniques + FKs (DB)           │  integridade estrutural
├─────────────────────────────────────────┤
│ 6. RLS Postgres (V2 opcional)           │  defesa em profundidade
└─────────────────────────────────────────┘
```

Nesta etapa entregamos **documentação + scaffolds da camada 3/4**.  
Camadas 1–2 entram com Auth. Camada 6 é pós-MVP.

---

## 6. Estado atual vs alvo

| Controle | Agora | Alvo pré-Auth CRUD |
|---|---|---|
| `TenantContext` scaffold | ✅ vazio | Preenchido no request |
| `TenantGuard` scaffold | ✅ allow-all | Enforce membership |
| Prisma tenant extension | ✅ scaffold **inativo** | Ativo + fail-closed |
| Prisma soft-delete extension | ✅ scaffold **inativo** | Ativo |
| Partial uniques M2 | ✅ no SQL (não applied) | Applied |
| RLS | ❌ | V2 |

---

## 7. Critérios de aceite antes de CRUDs reais

- [ ] Auth resolve user
- [ ] Membership valida company
- [ ] Extensions ativadas (após aprovação)
- [ ] Testes: tentativa cross-tenant retorna 403/404
- [ ] Query SQL de inspeção §4.4 = 0 rows após seeds/ops

---

**Não implementar Auth nesta etapa. Extensions não estão ligadas ao PrismaService.**
