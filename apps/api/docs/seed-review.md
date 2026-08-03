# Seed Review — AutoPilot MVP

**Status:** Seeds **implementados**, **não executados**  
**Pré-requisito:** migrations M1+M2 aplicadas no banco alvo (etapa futura aprovada)  
**Estratégia-base:** `docs/seed-strategy.md`

---

## 1. Arquivos criados

```text
prisma/
  seed.ts                         # entrypoint (profile via SEED_PROFILE / --profile)
  seeds/
    local.ts                      # perfil LOCAL
    demo.ts                       # perfil DEMO
    test.ts                       # perfil TEST + factories
    shared/
      client.ts                   # PrismaClient
      constants.ts                # slugs, emails, volumes
      factories.ts                # upserts idempotentes
docs/
  seed-review.md                  # este arquivo
```

Scripts npm (`package.json`):

- `npm run seed:local`
- `npm run seed:demo`
- `npm run seed:test`
- `prisma.seed` → `ts-node --transpile-only prisma/seed.ts`

---

## 2. Quantidade de registros (alvo por perfil)

### LOCAL

| Entidade | Quantidade |
|---|---|
| Companies | **1** (`local-demo`) |
| Users | **3** (OWNER, ADMIN, AGENT) |
| Memberships | **3** |
| Leads | **50** (todos os status D1, round-robin) |
| Conversations | ~42+ (leads ≠ NEW) |
| Messages | ~2–4 por conversa |
| Follow-ups | até 3 por lead elegível (SUGGESTED/APPROVED/EXECUTED) |
| Events / AuditLogs | amostrais |

### DEMO

| Entidade | Quantidade |
|---|---|
| Companies | **2** (concessionária + oficina) |
| Users | **5** |
| Memberships | **5** |
| Leads | **200** (100 por company) |
| Status coverage | NEW → LOST em ambas |
| Conversões | leads `CONVERTED` com `convertedAt` |
| Conversations + Messages | todos os leads (1–8 msgs) |
| Follow-ups | simulados (exceto LOST) |
| Events / AuditLogs | amostrais / fechamento |

### TEST

| Entidade | Quantidade |
|---|---|
| Companies | **1** (`test-fixture`) |
| Users | **1** OWNER |
| Memberships | **1** |
| Leads | **1** |
| Conversation + Messages | **1** conversa / **2** msgs |

Factories exportadas: `testFactories` em `seeds/test.ts`.

---

## 3. Regras atendidas

| Regra | Como |
|---|---|
| Idempotente | upsert company(slug), user(email), membership(company+user), lead(company+phone); skip messages se já existem; follow-ups por marcador `[SEED:key]` |
| Dados fake | e-mails `@local.autopilot.dev` / `@demo.autopilot.dev` / `@example.com`; phones `+1555…` |
| Sem dados reais | nomes/sintéticos; sem PII real |
| Sem Auth | `passwordHash = null` |
| Sem APIs | apenas Prisma |
| Multi-tenant | todo negócio com `companyId` |
| Soft delete aware | queries com `deletedAt: null`; preserva `firstResponseAt`/`convertedAt` |
| Proteção prod | recusa `NODE_ENV=production` sem `ALLOW_PROD_SEED=true` |

---

## 4. Comandos disponíveis

```bash
cd apps/api

# Pré-requisito (quando autorizado):
# npx prisma migrate deploy

npm run seed:local
npm run seed:demo
npm run seed:test

# Alternativa:
SEED_PROFILE=local npx ts-node --transpile-only prisma/seed.ts
npx ts-node --transpile-only prisma/seed.ts --profile=demo
```

Saída esperada: JSON com `profile` + `counts`.

---

## 5. Idempotência — comportamento no re-run

1. Companies/Users/Memberships atualizados in-place  
2. Leads atualizados pelo telefone (mesmos 50/200)  
3. Messages **não** duplicam se a conversa já tem mensagens ativas  
4. Follow-ups **não** duplicam se `suggestedBody` contém a chave seed  
5. `convertedAt` / `firstResponseAt` existentes **não** são sobrescritos com `null`

---

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Rodar seed sem migrations | Falha de tabela/enum — aplicar M1+M2 antes |
| Partial unique ausente (só M1) | Duplicatas possíveis; aplicar M2 |
| Re-seed com phones alterados no código | Novos leads + antigos permanecem |
| JSON path filter no Event/Audit | Depende de Postgres JSON; se falhar, criar duplicata rara de event |
| Volume demo (200 leads × msgs × follow-ups) | Pode levar alguns segundos; aceitável |

---

## 7. O que NÃO foi feito

- Execução dos seeds no banco  
- Execução de migrations/deploy  
- Auth / APIs / CRUDs  
- Seed de staging (perfil não pedido nesta entrega)

---

## 8. Próximos passos (após aprovação)

1. Subir Postgres  
2. `npx prisma migrate deploy`  
3. `npm run seed:local` (smoke)  
4. Opcional: `npm run seed:demo`  
5. Validar contagens e partial uniques  

---

**Aguardar aprovação antes de qualquer execução no banco.**
