# Design — Outbound Sales Engine V1

**Tipo:** auditoria + design (sem código · sem migrations · sem alteração de schema/APIs)  
**Data:** 2026-08-10  
**Branch:** `cursor/outbound-sales-engine-v1-design-dd93`  
**Base:** Autopilot CRM + WhatsApp (Evolution) + FollowUps + Recovery 11D + Sales Brain 11E  
**Documentos relacionados:**  
`docs/outbound-sales-engine-audit.md` · `docs/financial-services-vertical-design.md` · `docs/first-pilot-playbook.md`

---

## 0. Veredito

O Autopilot já é forte **depois** do primeiro contato (Recovery + Sales Brain). O Outbound Sales Engine V1 deve acrescentar apenas o que falta para **prospecção ativa controlada**:

1. **Importar** leads opt-in  
2. **Gerar e disparar first-touch** (1:1, com caps)  
3. **Entregar o lead no funil existente** (`CONTACTED` + `lastOutboundAt`)  
4. **Reusar** Recovery 11D e Sales Brain 11E sem motor paralelo de blast  

**Princípio V1:** um único caminho de envio (`WhatsappSendService` + FollowUp). Campanha = orquestração com limites, **não** ESP de massa.

**Fora de V1:** blast massivo, multi-número, A/B, templates oficiais Meta, scoring de lista avançado, underwriting/docs vault.

---

## 1. O que já existe · o que reutilizar · o que criar

### 1.1 O que já existe hoje

| Peça | Estado | Uso no outbound |
|------|--------|-----------------|
| Lead + status NEW→…→CONVERTED/LOST | ✅ | Destino do import; funil pós-contato |
| `phone` único por empresa (ativo) | ✅ | Deduplicação natural |
| `source`, `externalId`, `metadata` | ✅ / parcial | Tag de lista/campanha (metadata hoje pouco exposto na API) |
| Conversation + Message | ✅ | Thread do first-touch e replies |
| WhatsApp send texto 1:1 | ✅ | Único canal de disparo |
| FollowUp lifecycle + scheduler | ✅ | Execução agendada do D0 e da sequência |
| Recovery 11D | ✅ | D1/D3/D7… **após** first-touch |
| Sales Brain 11E (Memory, Score, Objection, NBA, Purchase Intent) | ✅ | Só pós-reply do lead |
| AI ASSIST/AUTO + KB | ✅ | Condução pós-resposta |
| Bulk assign + Export CSV | ✅ | Ops de fila humana |
| Caps de IA/Recovery (não de send humano) | ✅ parcial | Precisa estender para outbound |

### 1.2 O que pode ser reutilizado (sem reinventar)

```text
Import → Lead(NEW) + Conversation
         → First Touch (novo, estreito)
         → WhatsappSendService (existente)
         → Lead CONTACTED + lastOutboundAt
         → Recovery 11D (existente)        ← sequência pós-contato
         → reply inbound
         → Sales Brain 11E (existente)     ← qualificação
         → fila humana (HOT / HIGH intent)
```

| Módulo existente | Papel no V1 |
|------------------|-------------|
| `WhatsappSendService` / Evolution | Envio físico |
| `FollowUp` + DueScanner | Fila de D0 e retries leves |
| `AiRecoveryService` + cadência | Sequência D1+ (não cold NEW) |
| `AiAssistPipeline` + 11E.* | Pós-reply |
| `CompanyRecoverySettings` | Janela horária, maxAttempts, stopOnReply |
| Lead Workspace / Dashboards IA | Operação do closer |
| KB | Copy grounded de first-touch e recovery |

### 1.3 O que precisa ser criado (design V1)

| Módulo novo (conceitual) | Por quê |
|--------------------------|---------|
| **Lead Import** | Ingestão CSV/XLSX/manual com validação e dedupe |
| **Outbound Campaign** (leve) | Agrupar lote, status, caps e auditoria — sem blast |
| **First Touch Engine** | Gerar abordagem D0 personalizada + enfileirar envio |
| **Outbound Sequences (ponte)** | Mapear D0→hand-off para Recovery; política de cadência por vertical |
| **Outbound Caps / Anti-ban** | Limites diários empresa/número + warm-up |
| **Suppress / opt-out mínimo** | Bloquear reenvio (mesmo que tabela simples no design) |
| **Dashboard Outbound** | Funil importado→HOT→convertido |
| **ROI Outbound** | Fórmula operacional (horas, FTE, receita atribuída) |

**Não criar em V1:** segundo worker de blast, schema de produtos verticais, vault de documentos, papel ANALISTA.

---

## 2. Fluxos ideais por vertical

### 2.1 Financeiras / consórcios / crédito

**Origem dos leads (go):** opt-in próprio, clientes anteriores, indicação, lead de anúncio que pediu contato, parceiro loja.  
**No-go:** lista fria comprada; copy de “crédito aprovado”.

```text
Lista opt-in
  → Import (source=financeiro_optin)
  → Campanha "Reativação Qx" (DRAFT→READY)
  → First Touch ASSIST/humano ou semi-auto com cap baixo
  → CONTACTED + lastOutboundAt
  → Recovery conservador (ex. D1, D3, D7) — tom consultivo
  → Reply → 11E (TRUST/AUTHORITY → escalate)
  → HOT / Purchase Intent HIGH → Closer
  → Docs + análise → Analista (fora do Autopilot)
  → CONVERTED / LOST
```

| Papel | No outbound V1 |
|-------|----------------|
| **Operador / SDR** | Valida import, aprova lotes D0, monitora caps |
| **Closer** | Só leads que responderam / HOT |
| **Analista** | Fora do chat; recebe caso já triado |

**Caps sugeridos (piloto):** 20–40 first-touches/dia/número · Recovery max 2–3 · ASSIST na 1ª semana.

---

### 2.2 E-commerce

**Origem:** carrinho abandonado, browse, base própria, pós-compra cross-sell.  
**Tom:** benefício + pergunta; oferta grounded em KB PRICE/PRODUCT.

```text
Evento/lista (carrinho / base)
  → Import + campanha "Carrinho 7d"
  → First Touch D0 (lembrete + CTA)
  → Recovery D1 / D3 (oferta alternativa se PRICE)
  → Reply → 11E (PRICE→OFFER_ALTERNATIVE; HOT→humano/fechamento)
  → CONVERTED
```

| Papel | Uso |
|-------|-----|
| Operador | Import diário + liberar lote |
| Closer / CS | HOT e reclamações (escalate) |
| Analista | N/A |

**Caps:** 40–80/dia se número aquecido; ainda sem blast.

---

### 2.3 Imobiliária

**Origem:** portais (ZAP/OLX/etc. export), plantão, indicação, lista de interessados por bairro/faixa.  
**Tom:** consultivo; cidade/bairro/faixa de preço; visita como CTA.

```text
Export portal / lista interessados
  → Import (bairro, faixa, tipologia em colunas → metadata)
  → First Touch D0 personalizado (“vi seu interesse em {bairro}”)
  → Recovery D1 / D3 / D7 (disponibilidade / visita)
  → Reply → 11E (ASK_CITY/BUDGET/PRODUCT; TRUST comum)
  → HOT → Corretor humano agenda visita
  → CONVERTED = visita ou proposta (definir com cliente)
```

| Papel | Uso |
|-------|-----|
| Operador | Import + D0 |
| Corretor (closer) | HOT / visita |
| Analista | N/A (crédito imobiliário externo se houver) |

**Caps:** 30–50/dia; personalização forte reduz ban e aumenta reply.

---

### 2.4 Energia solar

**Origem:** leads de simulação web, feiras, indicação, base de contas de luz altas (opt-in).  
**Tom:** economia + diagnóstico; pedir conta de luz / consumo; ciclo médio-longo.

```text
Lead simulação / opt-in
  → Import (consumo kWh, cidade, tipo telhado → metadata)
  → First Touch D0 (“posso te mostrar a economia estimada”)
  → Recovery D3 / D7 / D15 (prova social, case local)
  → Reply → 11E (BUDGET/CITY/TIME; NEED/AUTHORITY → humano)
  → HOT → Consultor técnico/comercial
  → CONVERTED = visita técnica / proposta
```

| Papel | Uso |
|-------|-----|
| Operador | Lotes semanais |
| Consultor (closer) | HOT + proposta |
| Analista / engenharia | Fora (dimensionamento) |

**Caps:** 25–40/dia; sequência mais longa (D15) alinhada ao ciclo.

---

## 3. Arquitetura alvo V1 (conceitual)

```text
+--------------+     +-------------------+     +--------------------+
| Lead Import  |---->| Outbound Campaign |---->| First Touch Engine |
| CSV/XLSX/UI  |     | lote / status     |     | copy D0 + enqueue  |
+--------------+     +---------+---------+     +----------+---------+
                               |                          |
                               | caps / suppress          v
                               |                 WhatsappSendService
                               |                          |
                               |                          v
                               |              Lead CONTACTED + lastOutboundAt
                               |                          |
                               |                          v
                               |                 Recovery 11D (D1+)
                               |                          |
                               |                     reply inbound
                               |                          v
                               |                 Sales Brain 11E
                               |                          v
                               +----------------> Dashboard + fila HOT
```

**Regra de ouro:** Campaign não fala com Evolution direto. Só cria trabalho para First Touch / FollowUp.

---

## 4. Módulo — Lead Import

### 4.1 Funções

| Função | Comportamento V1 |
|--------|------------------|
| **CSV** | Upload delimitado; encoding UTF-8; preview das 20 primeiras linhas |
| **XLSX** | Mesmo pipeline após parse tabular (lib no momento da implementação) |
| **Import manual** | Form multi-linha ou colar telefone+nome (UI) + API batch pequena |
| **Validação** | Telefone E.164-ish BR; nome opcional; email opcional; colunas obrigatórias configuráveis |
| **Deduplicação** | Por `companyId + phone` ativo; opções: skip / merge metadata / rejeitar linha |
| **Suppress check** | Cruzar com opt-out antes de criar/enfileirar |
| **Idempotência** | `importBatchId` + hash do arquivo; reprocessamento seguro |

### 4.2 Contrato conceitual de colunas

| Coluna | Obrigatória | Destino |
|--------|-------------|---------|
| `phone` | Sim | `Lead.phone` |
| `name` | Não | `Lead.name` |
| `email` | Não | `Lead.email` |
| `external_id` | Não | `Lead.externalId` |
| `source` | Não (default campanha) | `Lead.source` |
| `*` extras | Não | `Lead.metadata` (bairro, produto, consumo…) |

### 4.3 Estados do job de import

`UPLOADED → VALIDATING → VALIDATED → COMMITTING → COMPLETED` (+ `FAILED` / `CANCELLED`)

Relatório: `created` · `skippedDuplicate` · `skippedSuppress` · `invalid` · erros por linha.

### 4.4 Regras de segurança

- Tamanho máximo de arquivo e de linhas por lote (ex. design: ≤500 linhas/lote V1).  
- Não importar sem `campaignId` ou `source` de rastreio.  
- Dry-run obrigatório antes do commit (preview counts).  
- Papéis: OWNER/ADMIN importam; AGENT só se policy permitir.

### 4.5 Relação com schema atual (design only — não migrar agora)

Hoje `Lead` já suporta o destino. Novas entidades sugeridas para implementação futura: `LeadImportBatch`, `LeadImportRow` (ou equivalente em storage + Event). **Este documento não cria migrations.**

---

## 5. Módulo — Outbound Campaign

### 5.1 Conceitos

| Conceito | Definição V1 |
|----------|--------------|
| **Campanha** | Contêiner nomeado: objetivo, vertical/playbook, caps, janela horária, owner |
| **Lote (batch)** | Subconjunto de leads da campanha liberado para first-touch num dia/turno |
| **Segmento** | Filtro estático no V1 (resultado do import ou lista marcada); sem query builder avançado |
| **Status** | Ciclo de vida da campanha e do lote |

### 5.2 Status sugeridos

**Campanha:** `DRAFT → READY → RUNNING → PAUSED → COMPLETED → ARCHIVED`  
**Lote:** `PENDING → QUEUED → SENDING → DONE → CANCELLED`

Pause global: trava First Touch e novos Recovery *desta campanha* (Recovery global da company permanece configurável).

### 5.3 Campos conceituais da campanha

| Campo | Uso |
|-------|-----|
| `name`, `verticalPlaybook` | financeira / ecommerce / imobiliaria / solar / generic |
| `dailyCap`, `hourlyCap` | Anti-ban |
| `allowedHoursStart/End`, `timezone` | Pode espelhar Recovery |
| `firstTouchMode` | `HUMAN_APPROVE` \| `SEMI_AUTO` \| `AUTO` (V1 recomenda HUMAN_APPROVE ou SEMI_AUTO) |
| `sequenceProfile` | ponte para Recovery (ex. `CONSERVATIVE`, `STANDARD`) |
| `suppressOnKeywords` | pare, stop, sair… |
| `stats` | contadores desnormalizados para dashboard |

### 5.4 O que Campaign NÃO é no V1

- Não é broadcast instantâneo para N números.  
- Não bypassa FollowUp/send.  
- Não gerencia multi-número.  
- Não substitui Recovery (só configura o hand-off).

### 5.5 Segmento V1 (mínimo)

1. “Todos os leads deste importBatch”  
2. “Leads NEW com `source=X` e sem `lastOutboundAt`”  
3. Exclusão: LOST, suppress, já CONTACTED recente (cooldown)

---

## 6. Módulo — First Touch Engine

### 6.1 Objetivo

Gerar a **abordagem inicial (D0)** personalizada e enfileirar envio 1:1 com throttle, promovendo o lead para o mundo Recovery/11E.

### 6.2 Pipeline conceitual (por lead do lote)

```text
1. Elegibilidade: NEW (ou policy), phone ok, não suppress, WA CONNECTED, cap ok
2. Garantir Conversation OPEN/IDLE
3. Gerar copy (template vertical + variáveis + opcional LLM grounded em KB)
4. Modo:
   - HUMAN_APPROVE → FollowUp SUGGESTED type=OUTBOUND_FIRST_TOUCH
   - SEMI_AUTO → FollowUp SCHEDULED após review amostral
   - AUTO → FollowUp SCHEDULED direto (só se caps + opt-in ok)
5. Execute via WhatsappSendService
6. Side-effects: lastOutboundAt, lastContactAt, status NEW→CONTACTED
7. Registrar evento campanha + métricas
8. Hand-off: lead fica elegível ao Recovery 11D
```

### 6.3 Personalização (sem spam genérico)

Variáveis mínimas: `{nome}`, `{empresa}`, `{produto_interesse}`, `{cidade_bairro}`, `{contexto_lista}`.  
Se variável ausente → fallback curto, nunca inventar fato.

### 6.4 Exemplos de copy (ilustrativos)

**Financeira**

> Oi{, Nome}! Aqui é da {Empresa}. Vi que você pediu informações sobre crédito/consórcio. Posso te explicar as opções e o que costuma ser pedido na análise — sem compromisso. Qual valor você tem em mente?

**E-commerce**

> Oi{, Nome}! Notei que você olhou {produto}. Ainda está disponível — quer que eu te passe as condições de pagamento de hoje?

**Imobiliária**

> Oi{, Nome}! Vi seu interesse em imóveis em {bairro}. Tenho opções na faixa que costuma encaixar — prefere 2 ou 3 quartos para eu filtrar?

### 6.5 Guardrails de geração

- Não prometer aprovação / preço sem KB.  
- Não pedir CPF/senha/cartão no D0.  
- Comprimento curto (ex. ≤500 chars design).  
- Variação leve anti-template-identical (parações / abertura).  
- Proibir AUTO D0 em vertical financeira no piloto default.

### 6.6 Gap conhecido no produto atual

O send WhatsApp atual atualiza timestamps; promoção automática `NEW→CONTACTED` no 1º outbound é gap de política (citado na auditoria). **V1 design exige esse side-effect** na implementação futura do First Touch — sem alterar APIs neste documento.

---

## 7. Módulo — Outbound Sequences

### 7.1 Princípio

**Não criar um segundo Recovery.**  
D0 = First Touch Engine.  
D1+ = **Recovery 11D** (ou FollowUps manuais tipados) com perfil de cadência.

### 7.2 Exemplo de sequência canônica

| Dia | Motor | Objetivo | Nota |
|-----|-------|----------|------|
| **D0** | First Touch | Abrir conversa | Obrigatório para elegibilidade 11D |
| **D1** | Recovery R1 | Lembrete / valor | `cadenceHours[0]≈24` |
| **D3** | Recovery R2 | Prova / pergunta | `≈72` |
| **D7** | Recovery R3 | Último nudge | `≈168` |
| **D15** | Opcional V1.1 | Só verticais ciclo longo (solar/imóveis) | Exige `maxAttempts`/`cadence` estendidos **ou** FollowUp manual tipado `OUTBOUND_NURTURE` |

### 7.3 Perfis de sequência (config, não código novo paralelo)

| Perfil | Cadência alvo | Verticais |
|--------|---------------|-----------|
| `CONSERVATIVE` | D0 · D3 · D7 | Financeira |
| `STANDARD` | D0 · D1 · D3 | E-commerce |
| `LONG_CYCLE` | D0 · D3 · D7 · D15 | Solar / imobiliária |

Mapeamento V1 → `CompanyRecoverySettings` (enabled, maxAttempts, cadenceHours, cooldown, allowedHours, stopOnReply, stopOnHumanTakeover).

### 7.4 Stops (obrigatórios)

- Reply do lead → para sequência; acorda 11E  
- `agentPaused` / takeover humano  
- LOST / CONVERTED  
- Opt-out / keyword  
- Campanha PAUSED  
- Cap diário esgotado (atrasa, não burla)

### 7.5 O que falta vs Recovery hoje

| Gap | Design V1 |
|-----|-----------|
| Recovery ignora NEW sem `lastOutboundAt` | Resolvido pelo First Touch (não afrouxar elegibilidade para cold puro) |
| Cadência única por company | V1: 1 perfil por company no piloto; V2: override por campanha |
| Copy D15 / multi-step tipado | V1 usa recovery genérico + KB; copy rica por step = V2 |

---

## 8. Limites e anti-ban WhatsApp

### 8.1 Camadas de limite (design)

| Camada | Escopo | Exemplo V1 |
|--------|--------|------------|
| Cap por **empresa**/dia | First-touch + opcional recovery outbound | 50–100 msgs proativas/dia |
| Cap por **número**/dia | Instance Evolution | 30–80 (warm-up) |
| Cap por **hora** | Suavizar picos | 5–15/hora |
| Cap por **campanha**/dia | Lote | ≤ dailyCap da campanha |
| Cap por **lead** | Já existe em AUTO | Não bombardear mesmo lead |
| Janela horária | Company + campanha | Horário comercial local |
| Spacing | Delay mínimo entre sends | 30–120s jitter |

### 8.2 Warm-up (política operacional)

| Idade do número / uso | Cap first-touch/dia |
|-----------------------|---------------------|
| Novo / instável | 10–20 |
| 7d estável com conversas reais | 30–40 |
| 30d saudável | 50–80 |
| Qualquer sinal de restrição | Pause campanhas |

### 8.3 Anti-ban comportamental

- Opt-in / relação comercial obrigatória no V1.  
- Personalização + KB (evitar texto idêntico em massa).  
- Stop on reply imediato.  
- Sem links encurtadores duvidosos no D0.  
- Monitorar taxa de falha/block Evolution; auto-PAUSE se erro spike.  
- 1 instância/empresa (já é o modelo atual) = aceitar SPOF e não “escalar no bruto”.

### 8.4 Relação com limites existentes

Reutilizar circuit breaker / 429 wait / recovery rate 10/min / AUTO guards.  
**Novo:** contador diário de *proactive outbound* (first-touch + recovery de campanha) — hoje send humano não tem throttle de volume.

---

## 9. Dashboard Outbound

### 9.1 Funil mínimo

| Métrica | Definição |
|---------|-----------|
| **Importados** | Leads criados via import batches da campanha |
| **Contatados** | Leads com first-touch EXECUTED (`lastOutboundAt` set / status ≥ CONTACTED) |
| **Responderam** | Contatados com `lastInboundAt` > first-touch |
| **Qualificados** | Status QUALIFIED **ou** score/temperature WARM+ com critérios da company |
| **HOT** | temperature HOT e/ou Purchase Intent HIGH/VERY_HIGH |
| **Convertidos** | Status CONVERTED no período |

Taxas derivadas: reply rate, qualify rate, hot rate, convert rate (sobre contatados e sobre replies).

### 9.2 Operacionais

- Enfileirados / enviados hoje / restantes no cap  
- Recovery sent (R1/R2/R3)  
- Opt-outs / suppresses  
- Escalations humanos  
- Erros Evolution / campanhas PAUSED  
- Tempo médio até reply  

### 9.3 Visões

1. **Por campanha** (primária)  
2. **Por vertical/playbook**  
3. **Fila HOT** (ação do closer — pode reusar cards 11E no Lead Workspace)  
4. Company rollup (semana/mês)

### 9.4 Fontes de dados (reuse)

Lead timestamps/status · FollowUp type/status · Recovery dashboard metrics · 11E score/intent · Events/audits.  
Evitar pipeline analítico separado no V1.

---

## 10. ROI — como calcular

### 10.1 Fórmula base

```text
ROI = (Receita_atribuída − Custo_outbound) / Custo_outbound

Receita_atribuída = Σ margem dos deals CONVERTED com first-touch/campanha no período
                 (ou proxy: ticket_médio × conversões × margem%)

Custo_outbound = horas_ops×custo_hora
               + horas_closer_em_HOT×custo_hora
               + custo_canal (número/Evolution)
               + custo_LLM
               + (opcional) provisionamento de risco de ban
```

### 10.2 Horas economizadas

| Atividade | Baseline manual | Com V1 | Economia |
|-----------|-----------------|--------|----------|
| Discagem/WA manual lista | Alta | Import + lote | Alta |
| Follow-up D+1/D+3 | Alta | Recovery | Alta |
| Triagem de quem respondeu | Média | Score + Purchase Intent | Média |
| Copy D0 | Média | First Touch + approve | Média |

```text
Horas_economizadas ≈
  (leads_contatados × min_baseline_por_lead
   − minutos_ops_aprovacao_lotes
   − minutos_closer_só_HOT) / 60
```

### 10.3 Operadores substituídos (capacidade)

Usar o modelo da vertical financeira: capacidade liberada em FTE de SDR, **não** demissão automática.

```text
FTE_liberado ≈ Horas_economizadas_semana / jornada_semana
```

Pilotos típicos: **0,5–1 FTE** cedo; **1,5–2,5 FTE** maduro em atendimento (financeiras). E-commerce tende a liberar mais volume com menos ticket.

### 10.4 Receita gerada (atribuição)

**Regra V1 (simples):** conversão conta se  
`lead.campaignId/metadata.outboundCampaignId` presente **e**  
houve first-touch da campanha **e**  
`convertedAt` no período.

Evitar last-click de ads no V1.

### 10.5 Painel ROI (campos de input)

- Ticket médio / margem % (input do cliente)  
- Custo hora ops/closer  
- Conversões atribuídas (sistema)  
- Horas medidas ou estimadas  

Saída: ROI período · receita · FTE · custo por lead contatado · custo por HOT.

---

## 11. Modelo de permissões e compliance (V1)

| Tema | Design |
|------|--------|
| Quem cria campanha | OWNER/ADMIN |
| Quem aprova D0 | OWNER/ADMIN/AGENT designado |
| Opt-out | Keyword + status LOST + suppress list |
| Auditoria | Event/AuditLog por import, approve, send, pause |
| Dados sensíveis | D0 sem CPF; verticais reguladas = HUMAN_APPROVE default |
| Lista | Declaração de origem/opt-in no create da campanha (checkbox ops) |

---

## 12. Roadmap V1 · V2 · V3

Esforço em **complexidade relativa** (S / M / L / XL) e superfície — sem cronograma de calendário.

### 12.1 V1 — Outbound Controlado

**Objetivo:** importar → first-touch com caps → Recovery → 11E → HOT humano. Sem blast.

| Entrega | Complexidade | Superfície | Dependências / riscos |
|---------|--------------|------------|------------------------|
| Lead Import CSV + dry-run + dedupe phone | **L** | API nova + UI + storage batch | Validação telefone BR; metadata |
| Import manual / paste pequeno | **S–M** | UI + batch API | Reusa validação |
| Outbound Campaign leve (CRUD + status + lote) | **L** | API + UI + vínculo leads | Não pode virar blast |
| First Touch Engine (SUGGESTED/SCHEDULED + send path) | **L** | AI prompt + FollowUp type + side-effect CONTACTED | Gap NEW→CONTACTED; copy compliance |
| Ponte Sequence → Recovery profiles | **S–M** | Config/playbook | Ajuste fino cadenceHours |
| Caps empresa/número/dia + pause | **M–L** | Contadores + gate no send proativo | Crítico anti-ban |
| Suppress mínimo | **M** | Lista + check import/send | Compliance |
| Dashboard funil + fila HOT | **M** | Web + aggregations | Reusa 11E cards |
| ROI painel (inputs + fórmula) | **S–M** | Web | Dados de margem manuais |
| XLSX | **S** (se parser) | Import | Pode ficar fim de V1 |

**V1 total (ordem de grandeza):** **XL** se tudo junto; decomponível em fatias Import → Caps+FirstTouch → Campaign+Dashboard.

**Critério de done V1:** piloto real ≥1 vertical com reply rate mensurável e zero incidente grave de ban/compliance.

---

### 12.2 V2 — Outbound Assistido

| Entrega | Complexidade | Notas |
|---------|--------------|-------|
| Override de cadência/copy por campanha | **M** | Sem fork do Recovery core |
| Sequência tipada D0–D15 com steps nomeados | **L** | Ainda executa via FollowUp |
| NBA `FIRST_TOUCH` / `SCHEDULE_OUTREACH` | **M** | Extensão 11E.4 |
| Opt-out export + preferências | **M** | |
| Warm-up automático de caps | **M** | |
| Segmentos por metadata (bairro, produto) | **M–L** | |
| Templates versionados + aprovação jurídica | **M** | |
| XLSX + mapeamento de colunas UX | **S–M** | Se não entrou em V1 |

**V2 total:** **L–XL**. Risco: pressão por “aumentar cap” — goverança necessária.

---

### 12.3 V3 — Outbound Engine (produto)

| Entrega | Complexidade | Notas |
|---------|--------------|-------|
| Campaign builder completo + audiências dinâmicas | **XL** | |
| Multi-número / fila de instances | **XL** | Evolution/SPOF |
| A/B de copy e cadência | **L** | |
| Scoring de lista / previsao de reply | **L–XL** | |
| Integrações (Sheets, CRM, ads webhooks) | **L** cada | |
| Templates oficiais / migração canal | **XL** | Mudança estrutural |
| ROI contábil por campanha + cohort | **M–L** | |

**V3 total:** **XL+**. Só após V1/V2 estáveis e canal saudável.

---

## 13. Ordem de implementação recomendada (quando houver aprovação)

1. Caps + suppress + gate no send proativo  
2. Lead Import CSV (dry-run)  
3. First Touch (HUMAN_APPROVE) + side-effect CONTACTED  
4. Ligar Recovery profile  
5. Campaign leve (agrupa import + caps + stats)  
6. Dashboard + ROI  
7. SEMI_AUTO D0 por vertical segura (e-commerce)  

Financeira e solar permanecem HUMAN_APPROVE no D0 por mais tempo.

---

## 14. Checklist go / no-go (piloto V1)

| Go | No-go |
|----|-------|
| Lista opt-in / relação clara | Lista fria comprada |
| WA CONNECTED estável | Número novo sem warm-up + cap alto |
| Caps definidos e pause testado | AUTO D0 agressivo |
| Recovery stopOnReply ON | Sequência sem stop |
| KB da vertical | Copy de aprovação de crédito / spam |
| Closer para HOT | Expectativa de “set and forget” blast |
| Import ≤500/lote | Dump de 10k números |

---

## 15. Respostas diretas

| Pergunta | Resposta |
|----------|----------|
| **O que já existe?** | Leads, Conversas, WhatsApp 1:1, FollowUps, Recovery 11D, Sales Brain 11E, KB/ASSIST/AUTO, export/bulk assign |
| **O que reutilizar?** | Send path, FollowUp scheduler, Recovery como D1+, 11E pós-reply, settings de janela/stops, UI de lead/HOT |
| **O que criar?** | Import, Campaign leve, First Touch, ponte de sequências, caps/suppress, dashboard outbound, ROI |
| **Blast?** | Não no V1 |
| **Sales Brain no cold?** | Não inicia; qualifica quem responde |
| **Recovery no NEW?** | Não; só após first-touch |

---

## 16. Encerramento

Este documento **projeta** o Outbound Sales Engine V1.  
**Não implementa** código, migrations, schema nem APIs.

Próximo passo (só com aprovação explícita): abrir fase de implementação pela ordem do §13, começando por **caps + import + first-touch HUMAN_APPROVE**.

**PARAR aqui.**
