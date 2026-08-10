# Design — Outbound V1.4 Campaign Engine

**Tipo:** design (sem código · sem migrations · sem alteração de APIs)  
**Data:** 2026-08-10  
**Branch:** `cursor/outbound-campaign-engine-v1-4-design-dd93`  
**Base:** Protection V1.1 · Import V1.2 · First Touch V1.3 · Recovery 11D · Sales Brain 11E  
**Documentos relacionados:**  
`docs/outbound-sales-engine-v1-design.md` · `docs/outbound-protection-v1-1-review.md` · `docs/outbound-import-v1-2-review.md` · `docs/outbound-first-touch-v1-3-design.md` · `docs/outbound-first-touch-v1-3-review.md` · `docs/ai-sales-agent-11d-review.md` · `docs/ai-sales-agent-11e-design.md`

---

## 0. Veredito

Com Import (V1.2) e First Touch (V1.3) já operacionais, o gap restante para outbound controlado é **orquestração**: agrupar milhares de leads em campanhas nomeadas, liberar **lotes diários** com caps, pausar com segurança e medir funil até HOT/conversão.

**Campaign Engine V1** é um **contêiner + liberador de lotes** — não um ESP de blast.

```text
Lead Import V1.2
  → Campaign V1.4 (agrupa + status + lotes)
  → First Touch V1.3 (D0 1:1)
  → Protection V1.1 (caps / suppress / cooldown)
  → Recovery 11D (D1+)
  → reply → Sales Brain 11E (HOT / qualify)
```

**Princípio:** Campaign **não** fala com Evolution. Só seleciona leads e pede First Touch / respeita Protection. Recovery e 11E continuam nos motores existentes.

**Este documento não implementa código, migrations nem APIs.**

---

## 1. Como organizar milhares de leads em campanhas

### 1.1 Problema

Import V1.2 aceita até **500 linhas/lote**. Uma operação real pode ter **2k–20k+** números opt-in ao longo de semanas. First Touch V1.3 gera D0 por seleção/`importBatchId`, mas **sem** contêiner de negócio, pause global por iniciativa, nem funil por campanha.

### 1.2 Modelo mental (3 camadas)

```text
Campanha (estratégia)
  └── Segmento estático (quem entra)
        └── Lotes / Campaign Batches (quanto sai por dia)
              └── First Touch D0 (1 lead = 1 mensagem)
```

| Camada | Responsabilidade | Escala |
|--------|------------------|--------|
| **Campaign** | Nome, objetivo, origem declarada, status, vínculo com playbook/modo D0 | 1 por iniciativa (ex. “Reativação Q3 financeira”) |
| **Segmento** | Conjunto de leads elegíveis amarrados à campanha | milhares via N import batches |
| **Campaign Batch** | Fatia liberada para D0 (ex. 30–50/dia) | dezenas/centenas por dia, nunca blast |

### 1.3 Estratégia de ingestão em escala

1. **Vários `LeadImportBatch`** (V1.2) alimentam a **mesma** Campaign (anexar `importBatchId`s ou marcar leads com `metadata.outboundCampaignId` no attach).  
2. **Deduplicação** continua no phone (V1.2 + unique company+phone) — campanha não recria Lead.  
3. **Fila de trabalho** = leads da campanha em `NEW`, sem `lastOutboundAt`, sem suppress, sem D0 pendente/executado.  
4. **Liberação diária** = criar `CampaignBatch` com `quantidade` ≤ min(cap diário Protection, cap da campanha, maxBatch First Touch).  
5. **Pause** da campanha impede novos batches e novos generates D0; Recovery já enviado segue as stop rules 11D + Protection.

### 1.4 Anti-padrões (proibidos no V1)

| Anti-padrão | Por quê |
|-------------|---------|
| “Enviar para todos agora” | Ban WhatsApp + viola Protection |
| Query builder dinâmico complexo | Superfície V2+ |
| Segunda tabela de prospect | Lead já é a entidade |
| Motor de envio paralelo | Único path: FollowUp → WhatsappSendService |
| Recovery por campanha forked | 11D company-level; campanha só filtra elegibilidade/atribuição |

### 1.5 Exemplo operacional (5.000 leads)

```text
Dia 0: 10× import 500 → attach à Campaign "Opt-in Meta Jul"
       Segmento = 4.800 elegíveis (após dedupe/suppress)
Dia 1: Batch#1 quantidade=40 → First Touch HUMAN_APPROVE → envio
Dia 2: Batch#2 quantidade=40 …
…
Quando fila = 0 ou objetivo atingido → COMPLETED → ARCHIVED
```

Cap diário Protection (ex. 50) + spacing + janela horária **limitam** o ritmo independentemente do tamanho do segmento.

---

## 2. Entidade Campaign

### 2.1 Campos (V1)

| Campo | Tipo lógico | Obrigatório | Descrição |
|-------|-------------|-------------|-----------|
| **nome** | string | Sim | Nome operacional (“Reativação Consórcio Ago”) |
| **status** | enum | Sim | Ver §4 |
| **origem** | string | Sim | Declaração de procedência da lista (opt-in, indicação, base própria, parceiro…) — compliance ops |
| **descrição** | text | Não | Contexto interno para o time |
| **objetivo** | string | Sim | Meta comercial curta (“reativar base”, “carrinho 7d”, “leads portal Zona Sul”) |

### 2.2 Campos de orquestração (complementares V1)

| Campo | Uso |
|-------|-----|
| `verticalPlaybook` | financeira / imobiliaria / solar / ecommerce / generic — alinha copy First Touch |
| `firstTouchMode` | herda/override de `CompanyFirstTouchSettings` (`OFF` bloqueia start) |
| `sequenceProfile` | ponte conceitual para Recovery (`CONSERVATIVE` / `STANDARD` / `LONG_CYCLE`) — config company no piloto |
| `dailyCap` / `hourlyCap` | **teto da campanha**; efetivo = min(campanha, Protection V1.1) |
| `importBatchIds[]` | vínculos a V1.2 (segmento inicial) |
| `ownerUserId` | OWNER/ADMIN responsável |
| `stats` | contadores desnormalizados para dashboard |
| `pausedAt` / `completedAt` / `archivedAt` | auditoria de ciclo |

### 2.3 Persistência conceitual (não migrar agora)

- Entidade sugerida: `OutboundCampaign` (tenant `companyId`, soft-delete, RLS).  
- Vínculo lead: `Lead.metadata.outboundCampaignId` (+ opcional `campaignBatchId`) — **sem** entidade paralela de prospect.  
- Este documento **não cria** schema/migration.

### 2.4 O que Campaign NÃO é

- Não é broadcast.  
- Não bypassa Protection / FollowUp / WhatsappSendService.  
- Não substitui Recovery 11D nem Sales Brain 11E.  
- Não gerencia multi-número.

---

## 3. Entidade Campaign Batch

Unidade de liberação controlada para First Touch.

### 3.1 Campos

| Campo | Tipo lógico | Descrição |
|-------|-------------|-----------|
| **segmento** | ref / snapshot | Critério ou lista congelada de leadIds elegíveis no momento do corte |
| **lote** | string/int | Identificador sequencial do batch na campanha (`#1`, `#2`…) |
| **quantidade** | int | Tamanho alvo do lote (ex. 40) — ≤ caps |

### 3.2 Campos auxiliares V1

| Campo | Uso |
|-------|-----|
| `status` | `PENDING → QUEUED → SENDING → DONE → CANCELLED` |
| `campaignId` | FK lógica |
| `selectedLeadIds[]` ou count + cursor | Materialização do corte |
| `generatedFollowUpCount` / `sentCount` | Progresso D0 |
| `scheduledFor` | Dia/turno de liberação |
| `errorSummary` | Falhas parciais |

### 3.3 Regras de corte (segmento → lote)

Elegível para entrar no batch:

1. Pertence à campanha (metadata / membership).  
2. `LeadStatus = NEW` (piloto) e `lastOutboundAt IS NULL`.  
3. Não suppress / não LOST / não CONVERTED.  
4. Sem FollowUp `OUTBOUND_FIRST_TOUCH` em SUGGESTED|SCHEDULED|EXECUTING|EXECUTED.  
5. Protection `canSendProactive` não bloqueia de forma permanente (caps temporários → batch menor ou adiamento).  
6. Ordem estável: `createdAt ASC` (FIFO da fila da campanha).

`quantidade` efetiva = min(pedido, restantes elegíveis, restante cap diário/horário).

### 3.4 Execução do batch

```text
Campaign RUNNING + Batch QUEUED
  → chama First Touch generate(leadIds do lote)
  → HUMAN_APPROVE: fila SUGGESTED (ops aprova)
  → AUTO_SEND: SCHEDULED (só se policy vertical ok)
  → send path existente
  → atualiza stats campanha/batch
```

Batch **DONE** quando todos os leads do corte estão em estado terminal D0 (EXECUTED / REJECTED / skip permanente) ou campanha PAUSED cancela restantes `PENDING`.

---

## 4. Status da Campaign

Estados pedidos para o produto V1.4 (ciclo operacional):

| Status | Significado | Transições típicas |
|--------|-------------|--------------------|
| **RUNNING** | Campanha ativa; pode criar/liberar batches e gerar D0 | → PAUSED, COMPLETED |
| **PAUSED** | Congelada: sem novos batches / sem novos generates D0 desta campanha | → RUNNING, ARCHIVED |
| **COMPLETED** | Objetivo cumprido ou fila esgotada; sem novos envios | → ARCHIVED |
| **ARCHIVED** | Histórico; somente leitura | (terminal) |

### 4.1 Estados de preparação (recomendados antes de RUNNING)

Para não “ligar” campanha incompleta:

| Status | Uso |
|--------|-----|
| `DRAFT` | Criação: nome, origem, objetivo, attach imports |
| `READY` | Segmento validado, caps ok, First Touch mode ≠ OFF, checklist opt-in |

Fluxo canônico:

```text
DRAFT → READY → RUNNING ⇄ PAUSED → COMPLETED → ARCHIVED
```

### 4.2 Efeitos de PAUSED

| Sistema | Comportamento |
|---------|---------------|
| First Touch | Não gera novos D0 com `outboundCampaignId` desta campanha |
| Novos Campaign Batches | Bloqueados |
| D0 já SUGGESTED | Permanecem; approve opcionalmente permitido (policy: sim, com audit) |
| D0 já SCHEDULED | DueScanner pode enviar **ou** soft-skip se policy “pause cancela queue” — **recomendação V1:** soft-skip / não cancelar suppress; ops pode rejeitar |
| Recovery 11D | Continua para leads já CONTACTED (stops 11D + Protection); não agenda cold |
| Import | Pode continuar anexando batches (opcional) sem disparar |

### 4.3 COMPLETED vs ARCHIVED

- **COMPLETED:** métricas finais congeláveis; ainda visível no dashboard “concluídas”.  
- **ARCHIVED:** remove da lista operacional; ROI histórico permanece consultável.

---

## 5. Caps — herdar V1.1 (não reinventar)

Todo D0 continua com `metadata.source = outbound_first_touch` → `OutboundProtectionService.canSendProactive`.

| Controle | Fonte | Papel na Campaign |
|----------|-------|-------------------|
| daily / hourly proactive cap | V1.1 company settings | Teto global |
| lead cooldown / min spacing / hours | V1.1 | Ritmo e janela |
| suppress / opt-out / LOST / CONVERTED | V1.1 | Exclusão dura |
| `dailyCap` / `hourlyCap` da campanha | Campaign V1.4 | Teto **adicional** ≤ Protection |
| warm-up ops | política | Caps baixos em número novo |

**Regra efetiva:**

```text
cap_envio = min(Protection.daily/hourly, Campaign.daily/hourly, Batch.quantidade restante)
```

Campaign **não** cria segunda tabela de caps nem bypass. Se Protection `enabled=false`, suppress ainda aplica; caps company off → só teto da campanha + bom senso ops (piloto recomenda Protection ON).

---

## 6. Integração ponta a ponta

```text
┌─────────────────┐
│ Lead Import V1.2│  CSV/XLSX/paste → Lead NEW + metadata
└────────┬────────┘
         │ attach importBatchIds / tag campaignId
         v
┌─────────────────┐
│ Campaign V1.4   │  DRAFT→READY→RUNNING; segmentos; batches
└────────┬────────┘
         │ liberar lote (quantidade)
         v
┌─────────────────┐
│ First Touch V1.3│  Conversation + FU OUTBOUND_FIRST_TOUCH + send
└────────┬────────┘
         │ NEW→CONTACTED + lastOutboundAt
         │ Protection V1.1 no send
         v
┌─────────────────┐
│ Recovery 11D    │  D1/D3/D7… se sem reply
└────────┬────────┘
         │ inbound reply
         v
┌─────────────────┐
│ Sales Brain 11E │  Memory / Score / Objection / NBA / Purchase Intent
└────────┬────────┘
         v
     HOT → closer humano → CONVERTED / LOST
```

| Etapa | Reuso | Campaign faz |
|-------|-------|--------------|
| Import | V1.2 | Anexa batches; não reimporta |
| D0 | V1.3 | Seleciona leadIds do batch; modo/playbook |
| Caps | V1.1 | Herda + teto próprio |
| D1+ | 11D | Atribuição/métricas; não fork do scanner |
| Qualificação | 11E | Conta HOT/qualify no funil da campanha |

**Sales Brain no cold:** não. Só pós-reply (inalterado).  
**Recovery no NEW:** não. Só após First Touch (inalterado).

---

## 7. Métricas por campanha (e por batch)

| Métrica | Definição |
|---------|-----------|
| **importados** | Leads criados/anexados à campanha (via import batches vinculados) |
| **elegíveis** | Subconjunto ainda apto a D0 (NEW, sem outbound, sem suppress, sem D0 feito) |
| **enviados** | D0 `EXECUTED` / Message SENT `outbound_first_touch` com `campaignId` |
| **respondidos** | Enviados com `lastInboundAt` > momento do D0 |
| **HOT** | temperature HOT e/ou Purchase Intent HIGH/VERY_HIGH (11E) entre contatados/respondidos |
| **convertidos** | `LeadStatus.CONVERTED` com atribuição à campanha |

Taxas derivadas: reply rate, HOT rate, convert rate (sobre enviados e sobre respondidos).

Contadores podem viver em `campaign.stats` (atualização eventual) + queries de verdade no dashboard.

---

## 8. Dashboard Campaign

UI alvo (design): `/outbound/campaigns` (+ detalhe `/:id`).

### 8.1 Visão rollup (company)

| Card | Definição |
|------|-----------|
| **Campanhas ativas** | status `RUNNING` (+ opcional `PAUSED`) |
| **Campanhas concluídas** | `COMPLETED` no período |
| **Taxa de resposta** | respondidos / enviados (rollup campanhas ativas ou período) |
| **Taxa HOT** | HOT / respondidos (ou / enviados — fixar na implementação; recomendação: / respondidos) |
| **Taxa de conversão** | convertidos / enviados |
| **ROI** | ver §8.3 |

### 8.2 Visão por campanha

- Funil: importados → elegíveis → enviados → respondidos → HOT → convertidos  
- Batches: lote, quantidade, status, progresso D0  
- Caps restantes (espelho Protection + teto campanha)  
- Opt-outs / erros Evolution / fila SUGGESTED  

### 8.3 ROI (operacional V1)

Reusar fórmula do design Outbound V1:

```text
ROI = (Receita_atribuída − Custo_outbound) / Custo_outbound

Receita_atribuída ≈ ticket_médio × convertidos_campanha × margem%
Custo_outbound ≈ horas_ops×custo_hora + horas_closer_HOT×custo_hora
               + canal + LLM (+ risco ban opcional)
```

Inputs manuais no painel (ticket, margem, custo hora). Atribuição V1: lead com `outboundCampaignId` + D0 enviado + `convertedAt` no período.

### 8.4 Fontes

Lead · LeadImportBatch · FollowUp First Touch · Message · 11E score/intent · Protection dashboard · AuditLog.  
Sem warehouse novo no V1.

---

## 9. Permissões e compliance

| Ação | Roles |
|------|-------|
| Criar/editar campanha, mudar status | OWNER / ADMIN |
| Anexar import batches | OWNER / ADMIN |
| Liberar Campaign Batch | OWNER / ADMIN |
| Aprovar D0 | OWNER / ADMIN / AGENT (como V1.3) |
| Declarar **origem** opt-in | Obrigatório no READY→RUNNING (checkbox + campo texto) |

Auditoria conceitual: `CAMPAIGN_CREATED` · `STATUS_CHANGED` · `BATCH_RELEASED` · `IMPORT_ATTACHED` · `ARCHIVED`.

---

## 10. Observabilidade (design)

| Tipo | Exemplos |
|------|----------|
| Audits | `OUTBOUND_CAMPAIGN_*` / `CAMPAIGN_BATCH_*` |
| Prometheus | `outbound_campaign_active`, `outbound_campaign_batch_released_total`, `outbound_campaign_reply_rate` |
| Ops | pause em spike FAILED Evolution; alinhar com Protection remaining |

---

## 11. Roadmap

Complexidade relativa **S / M / L / XL** — sem calendário.

### 11.1 V1 — Campaign Controlado (este design)

**Objetivo:** organizar milhares de leads em campanhas + lotes diários + funil + pause, reusando Import/First Touch/Protection/11D/11E.

| Entrega | Complexidade |
|---------|--------------|
| CRUD Campaign (nome, status, origem, descrição, objetivo) | **M** |
| Attach Import batches + tag `outboundCampaignId` | **M** |
| Campaign Batch (segmento, lote, quantidade) + release → First Touch | **L** |
| Status RUNNING/PAUSED/COMPLETED/ARCHIVED (+ DRAFT/READY) | **M** |
| Caps herdados V1.1 + teto campanha | **S–M** |
| Dashboard funil + taxas + ROI inputs | **M** |
| Audits + métricas Prometheus | **S** |

**Critério de done V1:** ≥1 campanha real com múltiplos imports, batches diários ≤ cap, pause testado, funil até respondidos/HOT mensurável — **zero** blast.

### 11.2 V2 — Campaign Assistido

| Entrega | Complexidade |
|---------|--------------|
| Override cadência/copy por campanha (sem fork 11D) | **M** |
| Segmentos por metadata (cidade, produto, valor) | **M–L** |
| Warm-up automático de caps | **M** |
| Opt-out export / preferências por campanha | **M** |
| Templates versionados + aprovação jurídica | **M** |
| NBA / fila “liberar próximo lote” sugerida | **M** |

### 11.3 V3 — Campaign Engine (produto)

| Entrega | Complexidade |
|---------|--------------|
| Builder completo + audiências dinâmicas | **XL** |
| Multi-número / fila de instances | **XL** |
| A/B de copy e cadência | **L** |
| Scoring de lista / previsão de reply | **L–XL** |
| Integrações (Sheets, CRM, ads webhooks) | **L** cada |
| ROI contábil por cohort | **M–L** |

---

## 12. Ordem de implementação recomendada (quando aprovado)

1. Model Campaign + status DRAFT/READY/RUNNING/PAUSED/COMPLETED/ARCHIVED  
2. Attach Import + membership de leads (`metadata.outboundCampaignId`)  
3. Campaign Batch release → First Touch generate(leadIds)  
4. Pause/complete/archive + gates  
5. Dashboard funil + taxas + ROI inputs  
6. Caps teto campanha (min com V1.1)  
7. Polish ops (audits, Prometheus, UI `/outbound/campaigns`)

**Não** afrouxar elegibilidade Recovery para cold NEW.  
**Não** enviar fora do First Touch / Protection.

---

## 13. Contratos conceituais (não implementar agora)

```text
GET/POST   /api/outbound/campaigns
GET/PATCH  /api/outbound/campaigns/:id
POST       /api/outbound/campaigns/:id/attach-imports
POST       /api/outbound/campaigns/:id/batches          // { quantidade }
POST       /api/outbound/campaigns/:id/pause|resume|complete|archive
GET        /api/outbound/campaigns/dashboard
GET        /api/outbound/campaigns/:id/metrics
```

UI: `/outbound/campaigns`, `/outbound/campaigns/[id]`.

---

## 14. Respostas diretas

| Pergunta | Resposta |
|----------|----------|
| **Como organizar milhares de leads?** | N imports → 1 Campaign → segmentos estáticos → batches diários com `quantidade` ≤ caps |
| **Campaign vs First Touch?** | Campaign orquestra quem/quando; First Touch gera/envia D0 |
| **Caps?** | Herdados de Protection V1.1; campanha só aperta o teto |
| **Recovery / 11E?** | Inalterados; campanha atribui e mede |
| **Blast?** | Não no V1 |

---

## 15. Encerramento

Este documento **projeta** o Campaign Engine V1.4.  
**Não implementa** código, migrations, schema nem APIs.

Próximo passo (só com aprovação explícita): implementar pela ordem do §12, começando por **Campaign CRUD + attach Import + Batch → First Touch + PAUSED/RUNNING**.

**PARAR aqui.**
