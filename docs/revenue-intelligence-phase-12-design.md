# Design — Fase 12 Revenue Intelligence

**Tipo:** design (sem código · sem migrations · sem alteração de APIs)  
**Data:** 2026-08-12  
**Branch:** `cursor/revenue-intelligence-phase-12-design-dd93`  
**Base:** Campaign MVP V1.4A · Sales Brain 11E · Lead Scoring · Purchase Intent · Pipeline · Dashboard  
**Documentos relacionados:**  
`docs/outbound-campaign-mvp-v1-4a-review.md` · `docs/outbound-campaign-engine-v1-4-design.md` · `docs/ai-sales-agent-11e-design.md` · `docs/outbound-sales-engine-v1-design.md` · `apps/api/docs/dashboard-design.md`

---

## 0. Veredito

Com Import → Campaign → First Touch → Recovery → Sales Brain já operacionais, o gap restante para **provar valor comercial** é medir **resultado real**: não só “mensagens enviadas”, mas **receita atribuída**, **ROI** e **economia de atendimento** ligados à cadeia Lead → Campaign → Conversation → Conversion.

**Revenue Intelligence (Fase 12)** é a camada de **atribuição + KPIs + scorecards** — não um segundo CRM, não um data warehouse, não um BI genérico.

```text
Campanha gera contato
  → Conversa qualifica (score / intent / HOT)
  → Pipeline converte
  → Revenue Intelligence atribui receita e calcula ROI / savings
```

**Este documento não implementa código, migrations nem APIs.**

---

## 1. Como medir resultado real das campanhas

### 1.1 Problema

O Campaign MVP V1.4A já expõe funil operacional:

```text
leads → elegíveis → first-touch enviados → responderam → HOT → convertidos
```

Isso responde “a máquina rodou?”. **Não** responde sozinho:

- quanto dinheiro entrou por causa da campanha?
- o ROI foi positivo?
- a IA substituiu quantos atendimentos / FTEs?
- qual campanha / operador / playbook performou de verdade?

### 1.2 Definição de “resultado real”

| Camada | Pergunta | Fonte |
|--------|----------|-------|
| **Operacional** | Contato e engajamento aconteceram? | Campaign V1.4A + First Touch + Messages |
| **Qualificação** | Lead virou oportunidade? | Lead Scoring + Purchase Intent + Sales Stage 11E |
| **Comercial** | Lead virou cliente? | Pipeline / `LeadStatus.CONVERTED` |
| **Financeira** | Quanto valeu? | Ticket × margem (inputs company) + atribuição |
| **Eficiência** | Quanto economizou vs humano? | Savings (atendimentos / tempo / FTE) |

**Resultado real da campanha** = conversões **atribuídas** × valor financeiro − custo outbound, com funil e savings como contexto operacional.

### 1.3 Princípios de medição

1. **Uma cadeia de atribuição** (ver §2) — sem multi-touch avançado no 12A.  
2. **KPIs com denominador explícito** (enviados vs respondidos vs convertidos).  
3. **Receita e ROI usam inputs declarados** (ticket médio, margem, custo/hora) até haver integração ERP.  
4. **HOT ≠ convertido** — HOT é sinal de prioridade (score ≥70 e/ou Purchase Intent HIGH/VERY_HIGH); conversão é CRM.  
5. **Sem blast metrics vanity** — volume sem atribuição não entra no scorecard executivo.  
6. **Reusar entidades existentes** — Lead, Campaign membership, Conversation, FollowUp, Message, score/intent 11E, Dashboard.

### 1.4 O que NÃO contar como sucesso

| Anti-KPI | Por quê |
|----------|---------|
| Só “mensagens enviadas” | Ignora reply e receita |
| HOT sem reply | Score frio / falso positivo |
| Convertidos sem vínculo de campanha | Infla ROI outbound |
| Economia sem baseline de tempo humano | Savings inventado |
| ROI sem custo | Numerador sem denominador |

---

## 2. Revenue Attribution

### 2.1 Cadeia canônica

```text
Lead
  ↓  membership / metadata.outboundCampaignId
Campaign
  ↓  First Touch D0 + Conversation OPEN
Conversation
  ↓  11E (score / intent / stage) + Pipeline
Conversion  (LeadStatus.CONVERTED)
```

### 2.2 Regras de atribuição (V1 — first-touch campaign)

Um lead gera **crédito de receita para a campanha** quando **todas** as condições abaixo forem verdadeiras:

| # | Condição | Fonte |
|---|----------|-------|
| 1 | Lead pertence à campanha | `OutboundCampaignLead` ativo **ou** `Lead.metadata.outboundCampaignId` |
| 2 | Houve First Touch enviado | FollowUp `OUTBOUND_FIRST_TOUCH` `EXECUTED` (ou Message SENT com source `outbound_first_touch`) |
| 3 | Houve Conversation da jornada | Conversation ligada ao Lead (criada/reusada no D0) |
| 4 | Lead está `CONVERTED` | `LeadStatus.CONVERTED` (+ `convertedAt` se existir / audit equivalente) |
| 5 | Conversão no período do relatório | filtro `from`/`to` sobre data de conversão (não só `createdAt` do lead) |

**Modelo V1:** atribuição **first campaign touch** (primeira campanha que gerou D0 EXECUTED).  
Se o lead entrar em outra campanha depois, a receita **não** é reatribuída no 12A (evita double-count). Multi-touch / last-touch ficam para 12C+.

### 2.3 Eventos de ponte (lógicos — sem schema neste design)

| Evento lógico | Quando | Uso |
|---------------|--------|-----|
| `ATTR_TOUCH` | D0 EXECUTED com campaignId | Marca elegibilidade de atribuição |
| `ATTR_ENGAGED` | First inbound após D0 | Reply rate / savings conversacional |
| `ATTR_HOT` | Score ≥70 **ou** Purchase Intent HIGH/VERY_HIGH | Prioridade closer |
| `ATTR_CONVERTED` | Lead → CONVERTED | Fecha funil financeiro |
| `ATTR_REVENUE` | Conversão × ticket × margem | Receita atribuída |

Persistência concreta (JSON metadata vs tabela `RevenueAttribution`) é decisão de implementação **12A/12B** — este design só congela a semântica.

### 2.4 Receita atribuída

```text
Receita_atribuída(campanha, período) =
  Σ (ticket_médio × margem%) para cada lead ATTR_CONVERTED da campanha no período
```

| Input | Default sugerido (piloto) | Origem |
|-------|---------------------------|--------|
| `ticket_médio` | valor company settings | Manual OWNER/ADMIN |
| `margem%` | 1.0 se não informado (receita bruta) | Manual |
| Override por lead | opcional 12B | Campo `dealValue` futuro — **fora do 12A** |

### 2.5 Custo outbound (denominador do ROI)

```text
Custo_outbound ≈
  (horas_ops × custo_hora)
  + (horas_closer_HOT × custo_hora_closer)
  + custo_canal_estimado
  + custo_LLM_estimado
```

| Componente | Como estimar no 12A |
|------------|---------------------|
| Horas ops | `# aprovações D0 × min/aprovação` + `# imports × min/import` |
| Horas closer | `# HOT handoffs × min/handoff` |
| Canal | constante company (R$/msg) × enviados |
| LLM | tokens/custo OpenAI se disponível; senão constante por mensagem IA |

### 2.6 ROI

```text
ROI = (Receita_atribuída − Custo_outbound) / max(Custo_outbound, ε)
```

Exibir também **payback simples**: `Receita_atribuída / Custo_outbound` (múltiplo).

---

## 3. KPIs

### 3.1 Funil obrigatório

| KPI | Definição | Denominador típico |
|-----|-----------|--------------------|
| **Leads importados** | Leads criados via Import V1.2 no período **ou** anexados à campanha via attach-import | — (volume absoluto) |
| **First-touch enviados** | D0 `EXECUTED` (campaign-scoped quando houver membership) | / leads da campanha; / elegíveis |
| **Respostas** | Enviados com `lastInboundAt` > timestamp do D0 | / first-touch enviados → **reply rate** |
| **HOT** | `Lead.score ≥ 70` **e/ou** Purchase Intent `HIGH`/`VERY_HIGH` (11E) entre respondidos (recomendado) | / respostas → **HOT rate** |
| **Convertidos** | `LeadStatus.CONVERTED` com atribuição (§2) | / enviados → **convert rate**; / respostas → **close rate** |
| **Receita** | Receita_atribuída (§2.4) | R$ no período |
| **ROI** | Fórmula §2.6 | razão (−1…+∞); UI em % ou múltiplo |

### 3.2 KPIs auxiliares (contexto, não vanity)

| KPI | Uso |
|-----|-----|
| Elegíveis restantes | Operação de liberação de lote |
| SUGGESTED pendentes | Gargalo humano (First Touch HUMAN_APPROVE) |
| Opt-outs / suppress | Saúde de lista |
| LOST | Qualidade de targeting |
| Tempo médio até reply | Eficiência de cadência |
| Tempo médio HOT → CONVERTED | Eficiência de closer |
| Taxa HANDOFF 11E | Pressão humana pós-IA |

### 3.3 Alinhamento com sistemas existentes

| Sistema | Contribuição ao KPI |
|---------|---------------------|
| Import V1.2 | leads importados / attach |
| Campaign V1.4A | escopo + funil parcial já implementado |
| First Touch V1.3 | first-touch enviados |
| Protection V1.1 | caps / suppress (explicam gaps elegíveis→enviados) |
| Recovery 11D | engajamento D1+ (não muda atribuição first-touch) |
| Sales Brain 11E | score, Purchase Intent, HOT, stages |
| Pipeline / LeadStatus | convertidos |
| Dashboard Fase 6 | base company-wide; Fase 12 especializa receita/ROI |

---

## 4. Dashboards

Quatro superfícies. Uma composição por papel — sem “dashboard único inchado”.

### 4.1 Empresa (executivo / OWNER)

**Pergunta:** Estamos ganhando dinheiro com outbound + IA?

| Bloco | Conteúdo |
|-------|----------|
| Scorecard | Ver §6 |
| Funil company | importados → FT enviados → respostas → HOT → convertidos |
| Receita & ROI | período + comparação vs período anterior (12B) |
| Savings | atendimentos / horas / FTE (§5) |
| Top campanhas | por ROI e por convertidos |
| Alertas | reply rate ↓, custo ↑, HOT sem closer |

**UI alvo (design):** `/revenue` ou seção “Revenue” no dashboard company.  
**Roles:** OWNER / ADMIN.

### 4.2 Campanha (ops outbound)

**Pergunta:** Esta iniciativa funciona?

| Bloco | Conteúdo |
|-------|----------|
| Header | nome, status, objetivo, período |
| Funil da campanha | mesmos KPIs §3.1 no escopo da campanha |
| Receita atribuída / ROI da campanha | com inputs ticket/margem |
| Qualidade | HOT rate, intent HIGH, LOST, opt-out |
| Operação | elegíveis, SUGGESTED, caps restantes (espelho Protection) |
| Lista de convertidos | lead → valor estimado → data |

**UI alvo:** estender `/outbound/campaigns/:id` com aba/seção Revenue (12A/12B) — **sem** redesenhar Campaign Builder.

### 4.3 Operador (SDR / aprovador / closer)

**Pergunta:** O que preciso fazer hoje e qual meu impacto?

| Papel | Cards |
|-------|-------|
| **SDR / Ops** | D0 pendentes de approve · imports a anexar · reply rate do lote liberado |
| **Closer** | Fila HOT / Purchase Intent HIGH · handoffs 11E · conversões do período |
| **Ambos** | Tempo médio de ação · taxa de aceitação de sugestões IA |

**UI alvo:** `/outbound/first-touch` + fila HOT existente / pipeline — widgets de contribuição, não tela nova obrigatória no 12A.

### 4.4 IA (Sales Brain / eficiência do agente)

**Pergunta:** A IA está conduzindo venda e economizando atendimento?

| Bloco | Conteúdo |
|-------|----------|
| Stages | distribuição DISCOVERY→…→PURCHASE_INTENT / HANDOFF / CONVERTED |
| Scoring | média / distribuição; % HOT |
| Purchase Intent | LOW→VERY_HIGH counts |
| NBA / Objections | top objections; resolução |
| Assist vs Auto | volume, rejeições humanas, falhas |
| Custo LLM | se disponível (addendum 11E) |
| Contribuição | % conversas com reply tratadas sem humano até HOT/HANDOFF |

**UI alvo:** evoluir `/ai/dashboard` — seção Revenue Intelligence / Eficiência.

### 4.5 Relação entre dashboards

```text
Empresa  ← rollup de →  Campanha
                ↑
         atribuição §2
                ↑
Operador (ação)     IA (qualificação / savings)
```

---

## 5. Savings (economia de atendimento)

### 5.1 Objetivo

Quantificar **trabalho humano evitado** pela automação (First Touch + Recovery + respostas 11C/11E), sem fingir que HOT/closer zeraram.

### 5.2 Métricas

| Métrica | Definição |
|---------|-----------|
| **Quantidade de atendimentos** | Nº de conversas com ≥1 outbound automatizado **e** ≥1 inbound, em que a IA produziu ≥N respostas ASSIST/AUTO aceitas/enviadas antes de HANDOFF (N default = 1) |
| **Tempo economizado** | `atendimentos × minutos_baseline_humano` − `minutos_humanos_reais_estimados` |
| **FTE substituído** | `horas_economizadas_no_período / horas_úteis_FTE_no_período` |

### 5.3 Baselines (inputs company — manuais no 12A)

| Input | Sugestão piloto | Notas |
|-------|-----------------|-------|
| `min_por_primeiro_contato_humano` | 4–6 min | SDR digitando D0 |
| `min_por_followup_humano` | 3 min | Recovery manual |
| `min_por_resposta_humana` | 3–5 min | FAQ/qualificação |
| `horas_úteis_FTE_mês` | 140–160 h | jornada líquida |
| `custo_hora` | company | para R$ economizado |

### 5.4 Fórmulas

```text
Atendimentos_automatizados =
  count(conversas elegíveis §5.2)

Minutos_baseline =
  (# D0 auto/aprovado × min_primeiro_contato)
  + (# Recovery EXECUTED × min_followup)
  + (# respostas IA enviadas × min_resposta)

Minutos_humanos_reais ≈
  (# aprovações manuais × min_approve)
  + (# handoffs × min_handoff)
  + (# edições ASSIST × min_edicao)

Tempo_economizado = max(Minutos_baseline − Minutos_humanos_reais, 0)

FTE_substituído = (Tempo_economizado / 60) / horas_úteis_FTE_período

R$_economizado = (Tempo_economizado / 60) × custo_hora
```

### 5.5 Regras de honestidade

1. Savings **não** substitui ROI de receita — são eixos complementares.  
2. HANDOFF / COMPLAINT **não** contam como atendimento full-auto.  
3. Campanha PAUSED/COMPLETED congela acumulado; não “inventa” savings futuro.  
4. Sem baseline configurado → mostrar só contagens operacionais, não FTE.

---

## 6. Scorecard executivo

Cartão único (1 tela) para OWNER. Cinco números + um veredito.

### 6.1 Campos do scorecard

| Campo | KPI | Formato |
|-------|-----|---------|
| **Pipeline vivo** | FT enviados → respostas (reply rate) | `12% reply` |
| **Qualidade** | HOT rate sobre respostas | `28% HOT` |
| **Conversões** | convertidos atribuídos no período | `14` |
| **Receita** | Receita_atribuída | `R$ 48k` |
| **ROI** | §2.6 | `+3.2x` |
| **Savings** | FTE substituído + R$ economizado | `0.6 FTE · R$ 9k` |

### 6.2 Veredito operacional (semáforo)

| Estado | Critério sugerido (piloto — calibrável) |
|--------|-----------------------------------------|
| **Verde** | ROI ≥ 1.0 **e** reply rate ≥ meta company **e** convertidos > 0 |
| **Amarelo** | Reply/HOT ok mas ROI < 1 **ou** convertidos = 0 com volume alto |
| **Vermelho** | Reply rate colapsado **ou** opt-out alto **ou** custo ≫ receita |

### 6.3 Narrativa automática (texto curto)

```text
No período {from–to}: {enviados} first-touches → {respostas} respostas ({replyRate}).
{hot} HOT · {convertidos} convertidos · receita {receita} · ROI {roi}.
Economia estimada: {fte} FTE ({rsEconomizado}).
Campanha destaque: {campaignName}.
```

Geração = template determinístico (12A); LLM narrativo opcional só em 12C.

### 6.4 O que o scorecard NÃO inclui

- Gráficos densos / 20 cards  
- Métricas de infra (Redis, workers) — ficam em Diagnostics  
- Detalhe de objection codes — fica no dashboard IA  

---

## 7. Roadmap

### 12A — Attribution + Funil financeiro (MVP)

**Objetivo:** provar cadeia Lead → Campaign → Conversation → Conversion com receita/ROI básicos.

| Entrega (design → futura implementação) | Notas |
|-----------------------------------------|-------|
| Contrato de atribuição first-touch (§2) | Reusa membership + D0 EXECUTED |
| KPIs §3.1 no rollup empresa + por campanha | Estender métricas V1.4A |
| Inputs company: ticket, margem, custo/hora | Settings manuais |
| Scorecard executivo (§6) | Somente leitura |
| Savings v0: contagens + tempo com baselines fixos | Sem FTE sofisticado |
| UI: cards Revenue em `/outbound/campaigns` + scorecard company | Sem builder |

**Fora de 12A:** multi-touch, ERP, warehouse, A/B, export contábil.

### 12B — Savings + Dashboards por papel

| Entrega | Notas |
|---------|-------|
| Savings completo (§5) com baselines configuráveis | FTE + R$ |
| Dashboard Operador (fila + contribuição) | SDR/Closer |
| Dashboard IA: contribuição até HOT/HANDOFF + custo LLM | `/ai/dashboard` |
| Comparação de períodos / ranking de campanhas | vs período anterior |
| Override `dealValue` por conversão (opcional) | se schema aprovado depois |
| Export CSV do funil atribuído | Ops/financeiro leve |

### 12C — Intelligence avançada

| Entrega | Notas |
|---------|-------|
| Modelos de atribuição alternativos (last-touch / linear) | Opt-in company |
| Cohort / payback por vertical playbook | Financeira, imob., etc. |
| Metas e alertas (reply, ROI, opt-out) | Notificações |
| Narrativa executiva assistida | Template+LLM opcional |
| Integração receita real (ERP/planilha) | Substitui ticket médio |
| Experimentos (pós A/B de campanha) | Só depois de Campaign V2 |

---

## 8. Fontes de dados (reuso — sem warehouse no 12A)

| Entidade / sinal | Uso |
|------------------|-----|
| `Lead` + status/score/`convertedAt` | Funil + HOT + conversão |
| `OutboundCampaign` + `OutboundCampaignLead` | Escopo campanha |
| `Lead.metadata.outboundCampaignId` / `importBatchId` | Ponte import/campanha |
| `FollowUp` First Touch / Recovery | Enviados |
| `Message` inbound/outbound | Respostas / volume IA |
| `Conversation.metadata.salesMemory` | Stages / intent / NBA |
| Purchase Intent + score 11E | HOT quality |
| Protection / Suppress | Explicabilidade de gaps |
| Company settings (novos inputs lógicos) | Ticket, margem, baselines |
| `AuditLog` | Trilha CONVERTED / CAMPAIGN_* / AI_* |

---

## 9. Permissões e compliance

| Ação | Roles |
|------|-------|
| Ver scorecard / receita / ROI | OWNER / ADMIN |
| Ver dashboard campanha (métricas) | OWNER / ADMIN (+ AGENT read-only opcional 12B) |
| Editar inputs financeiros / baselines | OWNER / ADMIN |
| Ver fila operador | OWNER / ADMIN / AGENT |
| Export financeiro | OWNER / ADMIN |

Compliance: Revenue Intelligence **não** reenvia mensagens; só lê. Listas opt-in e Protection continuam soberanas. Não expor PII além do já permitido nas UIs de lead/campanha.

---

## 10. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Double-count de receita | First-touch campaign lock (§2.2) |
| Ticket médio irrealista | Defaults conservadores + disclaimer “estimado” |
| HOT inflado sem reply | HOT rate sobre **respondidos** |
| Savings otimista | Baselines editáveis + separar full-auto vs handoff |
| Confundir Dashboard Fase 6 com Revenue | Superfícies distintas; Fase 6 permanece operacional CRM |

---

## 11. Critérios de aceite do design (não da implementação)

- [x] Responde como medir resultado real das campanhas  
- [x] Define Revenue Attribution Lead → Campaign → Conversation → Conversion  
- [x] Define KPIs (importados, FT, respostas, HOT, convertidos, receita, ROI)  
- [x] Define dashboards Empresa / Campanha / Operador / IA  
- [x] Define Savings (atendimentos, tempo, FTE)  
- [x] Define Scorecard executivo  
- [x] Define roadmap 12A / 12B / 12C  
- [x] Sem código · sem migrations · sem APIs  

---

## 12. PARAR

**Somente design.**  
Não iniciar implementação 12A.  
Não criar migrations, endpoints nem UI neste PR.  
Não iniciar A/B, warm-up, Campaign Batch V2 nem multi-número.
