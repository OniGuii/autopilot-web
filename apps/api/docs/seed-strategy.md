# Estratégia de Seeds — AutoPilot MVP

**Status:** Estratégia documental (sem implementação de seed nesta etapa)  
**Schema:** `apps/api/prisma/schema.prisma`  
**Objetivo:** Definir como popular dados de forma segura, previsível e alinhada ao domínio.

---

## 1. Princípios

1. Seeds **nunca** rodam em produção real de clientes.
2. Seeds respeitam multi-tenancy: todo dado de negócio tem `company_id`.
3. Seeds respeitam soft delete: registros criados com `deleted_at = null`.
4. Seeds usam telefones/e-mails **fictícios** e claramente marcados (`+1555…`, `@example.com`).
5. Seeds são **idempotentes** quando possível (upsert por chaves naturais de ambiente).
6. Separar perfis de seed por ambiente — não misturar volume de demo com fixtures de teste.
7. Não depender de Evolution/OpenAI reais nos seeds base (mocks/ids externos fake).

---

## 2. Perfis de seed

| Perfil | Ambiente | Propósito | Volume |
|---|---|---|---|
| `local` | desenvolvimento | Dev diário, happy path | pequeno |
| `staging` | homologação | QA / UAT | médio |
| `demo` | demos comerciais | Pitch / POC | rico e “bonito” |
| `test` | CI / Jest | Determinístico e mínimo | mínimo |

Sugestão de comando futuro (não implementado agora):

```bash
npm run seed -- --profile=local
npm run seed -- --profile=staging
npm run seed -- --profile=demo
# testes: fixtures via Nest Testing Module / factory, não seed global
```

---

## 3. Ordem de criação (obrigatória)

Respeitar FKs do schema:

1. `Company`
2. `User`
3. `Membership` (User → Company)
4. `Lead`
5. `Conversation`
6. `Message`
7. `FollowUp` (após Conversation/Message se houver `result_message_id`)
8. `Event`
9. `AuditLog`

---

## 4. Dataset por perfil

### 4.1 `local` — desenvolvimento

**Company**
- 1 company: `AutoPilot Local` / slug `local-demo` / status `ACTIVE`

**Users + Memberships**
- 1 `OWNER` — `owner@local.autopilot.dev`
- 1 `ADMIN` — `admin@local.autopilot.dev`
- 1 `AGENT` — `agent@local.autopilot.dev`
- Todos `UserStatus.ACTIVE`, membership `status = "ACTIVE"`

**Leads (6 — um por status D1)**
| Status | Exemplo |
|---|---|
| `NEW` | lead sem contato |
| `CONTACTED` | já houve outbound |
| `RESPONDED` | respondeu no WhatsApp |
| `QUALIFIED` | pediu avaliação |
| `CONVERTED` | visitou a loja |
| `LOST` | sem interesse |

- Phones únicos E.164 fake (`+15550000001` …)
- `score` variado (0–100)
- `source = "WHATSAPP"` ou `"MANUAL"`

**Conversations / Messages**
- 1 conversation `OPEN` para leads ativos
- 3–8 messages por conversation (mix INBOUND/OUTBOUND)
- `external_*` com ids fake estáveis

**Follow-ups (híbrido D3)**
- 1 `SUGGESTED` (aguardando aprovação)
- 1 `APPROVED` / `SCHEDULED`
- 1 `EXECUTED` com `approved_by` + `result_message_id`

**Events / AuditLogs**
- Poucos registros ilustrativos (`lead.created`, `message.received`, `follow_up.suggested`)

---

### 4.2 `staging` — homologação

Estende `local` com:

- 2–3 companies (isolamento multi-tenant testável)
- 2 agents por company
- ~30–50 leads distribuídos nos 6 status
- Conversas idle + open
- Follow-ups em vários status (`SUGGESTED` … `SKIPPED`)
- Eventos suficientes para dashboard básico
- 1 company `SUSPENDED` (caso negativo de acesso)

**Uso:** QA de tenancy, listagens, filtros, aprovação de follow-up, regressão.

---

### 4.3 `demo` — demonstrações comerciais

Objetivo: contar a história “lead perdido → follow-up → conversão”.

**Narrativa sugerida (1 company hero)**
1. Company: loja/revenda fictícia com nome comercial forte
2. OWNER + 2 AGENTs com nomes reais-looking
3. Pipeline visível:
   - leads `NEW` / `CONTACTED` sem resposta (dor)
   - follow-ups `SUGGESTED` prontos para aprovar ao vivo
   - 1 fluxo completo até `CONVERTED` (visita/avaliação)
   - 1 `LOST` para contraste
4. Conversation rica (8–15 mensagens) mostrando tom consultivo
5. Scores altos nos leads quentes
6. Audit/Event limpos (não poluir UI se expostos)

**Regras demo**
- Dados realistas de automotivo/oficina, sem PII real
- Reset fácil entre demos (`seed:demo:reset` futuro)
- Sem dependência de WhatsApp real (ou sandbox opcional documentado)

---

### 4.4 `test` — testes automatizados

**Não** usar seed global pesado no CI.

Preferir:

| Abordagem | Quando |
|---|---|
| Factories (`createCompany`, `createLead`…) | unit / integration |
| Fixtures mínimas por suite | e2e Nest |
| DB efêmero (testcontainers / schema isolado) | e2e com Postgres |

**Fixture mínima padrão de teste**
- 1 Company
- 1 User OWNER + Membership ACTIVE
- 1 Lead `NEW` com phone único
- (opcional) 1 Conversation + 1 Message

Cada teste cria/limpa seu escopo (ou transaction rollback).

IDs/emails determinísticos por teste para asserts estáveis.

---

## 5. Regras de negócio nos seeds

| Regra | Como o seed deve respeitar |
|---|---|
| D1 Lead statuses | Apenas os 6 oficiais |
| D3 Follow-up híbrido | `EXECUTED` sempre com `approved_by` + `approved_at` |
| D4 Score | 0–100 |
| D6 Phone único/company | Garantir phones distintos por company no dataset |
| D7 Roles | Só OWNER/ADMIN/AGENT |
| D8/D10 Membership | Nenhum acesso sem membership |
| D9 Message | Sempre com `conversation_id` |

---

## 6. Idempotência e reset

### Chaves naturais sugeridas (upsert)

| Entidade | Chave de upsert (ambiente) |
|---|---|
| Company | `slug` (ex.: `local-demo`) |
| User | `email` |
| Membership | (`companyId`, `userId`) — app-level |
| Lead | (`companyId`, `phone`) — app-level |

### Reset

| Perfil | Estratégia |
|---|---|
| local/demo | `truncate` ordenado ou soft-delete + recreate dos slugs conhecidos |
| staging | job controlado; backup antes |
| test | DB limpo por suite / transaction |
| production | **proibido** |

---

## 7. Segredos e credenciais

- Senhas de seed: hash bcrypt de senha documentada só em `.env.example` / docs internas (`Local@123` etc.)
- Nunca commitar hashes de produção
- `OPENAI_*` / `EVOLUTION_*` não necessários para seed base

---

## 8. Estrutura de implementação futura (proposta)

```text
prisma/
  seed.ts                 # entrypoint por --profile
  seeds/
    local.ts
    staging.ts
    demo.ts
    shared/
      factories.ts
      constants.ts
```

`package.json` (futuro):

```json
{
  "prisma": { "seed": "ts-node prisma/seed.ts" }
}
```

**Não criar esses arquivos nesta etapa** — apenas a estratégia.

---

## 9. Critérios de aceite da implementação futura

- [ ] `local` sobe em < 30s com Postgres local
- [ ] Isolamento: queries da company A não veem company B (staging)
- [ ] Demo conta a jornada NEW → CONVERTED com follow-up aprovado
- [ ] Testes não dependem do seed `demo`
- [ ] Nenhuma PII real
- [ ] Idempotente no re-run de `local`/`demo`

---

## 10. Fora do escopo atual

- Código de seed
- Migration
- Anonymization pipeline de produção
- Seed de billing/planos reais
