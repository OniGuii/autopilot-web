# Prisma Extensions — AutoPilot MVP

**Status:** Scaffolds criados, **não ativados**  
**Código:** `src/prisma/extensions/`  
**Objetivo:** Preparar filtros automáticos de tenant e soft delete sem alterar o runtime atual

---

## 1. Arquivos

| Arquivo | Papel |
|---|---|
| `tenant.extension.ts` | Factory `createTenantExtension` + `assertSameTenant` + lista de models |
| `soft-delete.extension.ts` | Factory `createSoftDeleteExtension` + `notDeletedWhere` |
| `index.ts` | Re-exports |

`PrismaService` **não** importa nem aplica essas extensions nesta etapa.  
Comportamento da API permanece idêntico.

---

## 2. Tenant Extension (planejado)

### Responsabilidades futuras

1. Em models tenant-scoped, exigir `companyId` no contexto
2. Mesclar `where: { companyId }` automaticamente em `findMany` / `findFirst` / `findUnique` (quando aplicável)
3. Em `create`, injetar `companyId` do contexto se ausente; rejeitar se divergente
4. Em `update`/`delete`, garantir que o registro pertence ao tenant (fail-closed)
5. Não aplicar em `User` (global); tratar `Company` com cuidado (só a própria company)

### Models no escopo

`membership`, `lead`, `conversation`, `message`, `followUp`, `event`, `auditLog`

### Como será ativada (futuro)

```ts
// Ilustrativo — NÃO aplicado agora
const client = new PrismaClient()
  .$extends(createSoftDeleteExtension({ filterDeleted: true, rewriteDelete: true }))
  .$extends(createTenantExtension({ companyId, enforce: true }));
```

No Nest, a ativação tipicamente ocorre:

1. `TenantContext` resolve `companyId` por request
2. Factory/`REQUEST` scoped `PrismaService` ou wrapper aplica `$extends`
3. Ou extension lê AsyncLocalStorage com o tenant atual

**Decisão pendente de implementação:** client por request vs ALS global.

---

## 3. Soft Delete Extension (planejado)

### Responsabilidades futuras

1. `find*` → adicionar `deletedAt: null` por padrão
2. `delete` / `deleteMany` → `update` com `deletedAt: new Date()`
3. Escape controlado:
   - `includeDeleted: true` (admin/auditoria)
   - hard delete **proibido** na app MVP

### Como será ativada

Mesma cadeia `$extends` acima, preferencialmente **antes** da tenant extension (ordem a validar em testes).

Helper já utilizável sem ativação:

```ts
import { notDeletedWhere } from '../prisma/extensions';

prisma.lead.findMany({ where: notDeletedWhere({ companyId }) });
```

---

## 4. Riscos

| Risco | Detalhe | Mitigação |
|---|---|---|
| Ativar sem TenantContext | Fail-open ou fail-closed incorreto | Só ativar com Auth + context |
| `findUnique` por `id` sem tenant | Extension pode não injetar company em unique composto | Preferir `findFirst` + companyId; validar pós-fetch |
| Performance | Extensão em toda query | Manter lógica mínima; índices tenant já existem |
| Bypass via `$queryRaw` | SQL cru ignora extensions | Proibir raw em módulos de domínio |
| Ordem das extensions | Soft-delete vs tenant interagem | Suite de testes dedicada antes do go-live |
| Event.companyId null | Tenant filter pode esconder/erro | Regra explícita para events globais |
| Mudança de tipos Prisma | `$extends` altera tipo do client | Tipar PrismaService extended com cuidado |

---

## 5. Limitações (scaffolds atuais)

1. **Não filtram nada** — `defineExtension` vazio  
2. **Não estão registradas** no `PrismaModule` / `PrismaService`  
3. **Não substituem** Auth, Membership nem RLS  
4. **Não cobrem** validação composta lead↔conversation↔message (precisa assert de domínio)  
5. Helpers `assertSameTenant` / `notDeletedWhere` são manuais até a ativação  

---

## 6. Plano de ativação sugerido

| Fase | Ação |
|---|---|
| Agora | Scaffolds + docs (esta entrega) |
| Após Auth + TenantContext real | Ativar soft-delete (menor risco) |
| Em seguida | Ativar tenant extension com `enforce: true` |
| Antes de CRUDs públicos | Testes de vazamento cross-tenant |
| V2 | Avaliar RLS Postgres como defesa extra |

---

## 7. Critério para considerar “seguro o suficiente” para Auth/CRUD

- [ ] Extensions ativas em runtime
- [ ] TenantContext preenchido por request
- [ ] Testes automatizados V1–V5 de `tenant-safety.md`
- [ ] Migrations M2 aplicadas (partial uniques)
- [ ] Zero rows nas queries de inspeção cross-tenant

---

**Ativação global exige aprovação explícita em etapa futura.**
