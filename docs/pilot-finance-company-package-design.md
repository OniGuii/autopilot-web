# Package Design — Primeira Financeira Piloto

**Tipo:** playbook operacional (somente design · sem código · sem migrations · sem APIs novas)  
**Data:** 2026-08-12  
**Branch:** `cursor/pilot-finance-company-package-design-dd93`  
**Público:** ops Autopilot + champion OWNER da financeira  
**Base de produto:** Protection V1.1 · Import V1.2 · First Touch V1.3 · Campaign MVP V1.4A · Recovery 11D · Sales Brain 11E · Pipeline · Dashboard · Revenue Intelligence (design Fase 12)  
**Documentos relacionados:**  
`docs/financial-services-vertical-design.md` · `docs/first-pilot-playbook.md` · `docs/pilot-deployment-plan.md` · `docs/outbound-campaign-mvp-v1-4a-review.md` · `docs/revenue-intelligence-phase-12-design.md` · `docs/ai-sales-agent-11e-design.md`

---

## 0. Veredito

O Autopilot entra na financeira para **substituir triagem WhatsApp + cobrança de resposta + priorização de HOT** — não o analista de crédito.

```text
Setup company + WA + KB
  → Import opt-in
  → Campaign + First Touch (HUMAN_APPROVE)
  → Recovery (silêncio)
  → Reply → Sales Brain → fila HOT
  → Closer humano → docs → analista (fora)
  → CONVERTED / LOST
  → medir funil / ROI / FTE em 30 dias
```

**Este documento é o pacote operacional do piloto.** Não implementa produto.

---

## Premissas do piloto financeira

| Item | Valor |
|------|-------|
| Perfil | Financeira pequena / correspondente / consórcio local |
| Volume | 40–120 leads/mês (opt-in ou inbound próprio) |
| Canal | **1** WhatsApp Business (Evolution) |
| Time | 1 OWNER champion + 1–2 AGENT closers (+ analista fora do chat) |
| AI | **ASSIST** semana 1–2; AUTO só FAQ grounded depois |
| First Touch | **HUMAN_APPROVE** (nunca AUTO_SEND no D0 financeiro no piloto) |
| Listas | Opt-in próprio / base antiga com consentimento — **proibido** lista fria comprada |
| Duração | D0–D30 com checkpoint D7 / D14 / D30 |
| Fora | Vault de docs, bureau, formalização bancária, blast, multi-número |

---

## 1. Como configurar uma financeira do zero

### 1.1 Ordem canônica (Dia 0)

```text
1. Provisionar OWNER (ops Autopilot)
2. Criar company (setup)
3. Conectar WhatsApp
4. Convidar usuários (ADMIN/AGENT)
5. Settings company + Protection + AI + Recovery + First Touch
6. Popular KB mínima (§2)
7. Smoke test inbound/outbound
8. Só então: import + campanha (§3–§5)
```

### 1.2 Company e usuários

| Passo | Ação | Critério |
|-------|------|----------|
| A | Ops cria usuário OWNER (e-mail corporativo, senha temporária segura) | Login OK |
| B | Champion cria company (`name`, `slug`, `timezone=America/Sao_Paulo`, `locale=pt-BR`) | Select-company OK |
| C | Settings: currency `BRL`, nome fantasia | Dashboard carrega |
| D | Convidar 1 ADMIN (ops dia a dia) + 1–2 AGENT closers | Memberships ACTIVE |
| E | Treino 2h: Conversas, Lead Workspace, First Touch approve, fila HOT | Checklist §12 D0 |

Detalhe genérico de provisionamento: `docs/first-pilot-playbook.md` §1–§3.

### 1.3 WhatsApp

1. `/whatsapp` → conectar → QR → `CONNECTED`.  
2. 1 inbound real de celular de teste.  
3. 1 outbound de teste (composer ou follow-up).  
4. Número **dedicado** ao piloto (não misturar com blast marketing).

### 1.4 Protection V1.1 (obrigatório ON)

| Setting | Valor piloto financeira |
|---------|-------------------------|
| Protection enabled | **ON** |
| Daily proactive cap | **20–40**/dia (começar 20) |
| Hourly cap | **5–10**/hora |
| Lead cooldown / min spacing | Conservador (ex. ≥24h entre proactive) |
| Janela horária | Comercial (ex. 09:00–18:00, dias úteis) |
| Suppress / opt-out / LOST / CONVERTED | Sempre bloqueiam proactive |

UI: `/outbound/protection`.

### 1.5 AI / Recovery / First Touch (defaults)

| Módulo | Setting | Valor piloto |
|--------|---------|--------------|
| AI mode | ASSIST | Semana 1–2 |
| AI AUTO | OFF ou só FAQ grounded | Semana 3+ se qualidade OK |
| Recovery | ON | `maxAttempts` 2–3 · cadence ~24/72/168h |
| Stop on reply / human takeover | ON | Obrigatório |
| First Touch mode | **HUMAN_APPROVE** | Nunca OFF em operação; nunca AUTO_SEND no piloto |
| Vertical playbook | `financeira` | Alinha copy D0 |
| Campaign | DRAFT até KB + WA + Protection OK | §3 |

### 1.6 Inputs financeiros (para ROI / savings)

Registrar com o champion (planilha ou settings futuros da Fase 12):

| Input | Exemplo |
|-------|---------|
| Ticket médio | R$ 3.000–15.000 (consórcio/crédito — calibrar) |
| Margem % | margem comercial estimada |
| Custo/hora SDR | R$ … |
| Custo/hora closer | R$ … |
| Minutos baseline 1º contato humano | 5 |
| Minutos baseline follow-up / resposta | 3–4 |
| Horas úteis FTE / mês | 150 |

### 1.7 Critério “empresa pronta para leads”

- [ ] WA `CONNECTED` + 1 inbound/outbound reais  
- [ ] Protection ON com caps baixos  
- [ ] KB mínima publicada (§2)  
- [ ] First Touch `HUMAN_APPROVE` + playbook `financeira`  
- [ ] Recovery ON  
- [ ] Closers logados e treinados  

---

## 2. Qual KB mínima precisa existir

**Meta:** 12–20 entradas grounded. Sem KB, ASSIST/AUTO inventa — risco compliance em crédito.

### 2.1 Pack mínimo obrigatório

| # | Tema | Conteúdo mínimo | Tipo sugerido |
|---|------|-----------------|---------------|
| 1 | Disclaimer de não-aprovação | “Análise sujeita a política do parceiro/banco; não prometemos aprovação” | POLICY / FAQ |
| 2 | Produtos oferecidos | Consórcio / crédito pessoal / financiamento veículo (o que a empresa realmente vende) | PRODUCT |
| 3 | Prazos típicos | Faixas de prazo (indicativo) | PRODUCT |
| 4 | Taxas / condições | Só **indicativas** + “sujeito a análise” | PRICE |
| 5 | Documentos necessários | RG/CNH, CPF, renda, endereço (+ CRLV se veículo) | FAQ |
| 6 | Como funciona o processo | Captura → triagem → docs → análise → formalização | FAQ |
| 7 | Cidades / regiões atendidas | Cobertura real | FAQ |
| 8 | Horário de atendimento | Dias/horas | HOURS |
| 9 | Formas de pagamento / entrada | Pix, boleto, entrada mínima (se aplicável) | PAYMENT |
| 10 | Parceiros / bancos (alto nível) | Sem prometer taxa de parceiro X | PRODUCT |
| 11 | Opt-out | “Se não quiser contato, responda PARAR” (script) | POLICY |
| 12 | Escalation | Quando falar com humano / analista | POLICY |

### 2.2 Entradas recomendadas (semana 1)

| # | Tema |
|---|------|
| 13 | Diferença consórcio × crédito (se ambas linhas) |
| 14 | Tempo médio de análise (estimativa operacional, não SLA legal) |
| 15 | Objeção “está caro” — resposta consultiva sem desconto ilegal |
| 16 | Objeção “preciso pensar” — próximo passo suave |
| 17 | FAQ “aprovam negativado?” — resposta honest + escalate |
| 18 | Contato humano / telefone da loja |

### 2.3 Regras de conteúdo (compliance)

1. Nunca “crédito aprovado”, “score liberado”, “garantido”.  
2. Sempre amarrar condição a **análise do parceiro**.  
3. Não pedir CPF/senha/cartão via copy da KB de IA no piloto — closer humano pede dados sensíveis.  
4. Toda taxa = **indicativa**.  
5. Revisar KB com champion antes do primeiro D0.

UI: `/ai/knowledge-base`.

---

## 3. Quais campanhas iniciais criar

Usar Campaign MVP V1.4A (`/outbound/campaigns`). **3 campanhas no máximo** no mês 1.

### 3.1 Campanha A — Reativação base opt-in

| Campo | Valor |
|-------|-------|
| Nome | `Reativação Base Opt-in {Mês}` |
| Objetivo | Retomar interessados antigos que pediram contato |
| Descrição | Base própria com consentimento; volume baixo |
| Status inicial | DRAFT → READY após attach |

**Fonte de leads:** planilha de clientes/interessados que optaram.  
**Volume D0:** 15–25/dia (≤ cap Protection).

### 3.2 Campanha B — Inbound Meta / landing (se existir)

| Campo | Valor |
|-------|-------|
| Nome | `Leads Meta {Campanha Ads}` |
| Objetivo | Triagem rápida de leads quentes de anúncio |
| Descrição | Export periódico do anúncio / CRM leve |

**Fonte:** export do anúncio (telefone + nome + produto interesse).  
**Prioridade:** maior que reativação fria.

### 3.3 Campanha C — Parceiros / indicação (opcional D14+)

| Campo | Valor |
|-------|-------|
| Nome | `Indicação Parceiros {Mês}` |
| Objetivo | Contatar indicações de loja/oficina/corretor |
| Descrição | Só com autorização do parceiro/cliente |

### 3.4 O que NÃO criar

- Campanha “lista comprada”  
- Campanha blast “enviar para todos agora”  
- Mais de uma campanha RUNNING no mesmo número se cap diário < 40 (piloto: **1 RUNNING** por vez)

### 3.5 Ciclo de status

```text
DRAFT (criar + attach import)
  → READY (KB + WA + Protection + FT mode OK)
  → RUNNING (gerar First Touch em lotes)
  ⇄ PAUSED (incidente / fim do expediente / reply rate ruim)
  → COMPLETED → ARCHIVED
```

---

## 4. Como importar leads

### 4.1 Canal

UI: `/outbound/import` (CSV / XLSX / paste).  
Lotes ≤ **500** linhas; no piloto preferir **50–150**/lote.

### 4.2 Colunas mínimas

| Coluna | Obrigatória | Notas |
|--------|-------------|-------|
| Telefone | Sim | E.164 BR quando possível |
| Nome | Sim | |
| Produto | Recomendada | consórcio / crédito / veículo |
| Cidade | Recomendada | |
| Origem / source | Recomendada | `base_optin`, `meta_ads`, `indicacao`, `parceiro_loja` |

### 4.3 Fluxo operacional

```text
1. Preparar planilha (dedupe telefone na origem)
2. Paste/CSV → mapping colunas
3. Validate → corrigir erros
4. Commit → Leads NEW + metadata.importBatchId
5. Abrir campanha → Attach import (selecionar todos do lote)
6. Conferir contagem na campanha
```

### 4.4 Regras

| Regra | Por quê |
|-------|---------|
| Só opt-in / inbound próprio | Ban + compliance |
| Dedupe por telefone | Unique company+phone |
| Não importar LOST/opt-out conhecidos | Suppress |
| Anotar `source` consistente | Medição D30 |
| Não gerar First Touch no import | Import só cria Lead |

### 4.5 Critério “import OK”

- [ ] Report de commit: created > 0, erros entendidos  
- [ ] Leads visíveis em `/leads`  
- [ ] Membership na campanha via attach-import  

---

## 5. Como usar First Touch

### 5.1 Objetivo

D0 = primeira abordagem 1:1. Promove `NEW → CONTACTED` após envio. **Não** é blast.

### 5.2 Configuração

UI: `/outbound/first-touch`

| Setting | Valor |
|---------|-------|
| Mode | `HUMAN_APPROVE` |
| verticalPlaybook | `financeira` |
| enableKbGrounding | ON (com KB §2) |
| maxBatchSize | ≤ 50; operar 15–25/dia |

### 5.3 Operação diária (champion / ops)

```text
1. Campanha RUNNING
2. POST generate (pela UI da campanha ou First Touch) com limit do dia
3. Revisar cada SUGGESTED:
   - tom consultivo?
   - sem promessa de aprovação?
   - nome/produto/cidade ok?
4. Approve → SCHEDULED → envio via path existente (Protection gate)
5. Reject / editar se copy ruim; ajustar KB se padrão se repetir
```

### 5.4 Copy D0 — checklist humano

- [ ] Cumprimento + nome  
- [ ] Motivo do contato (interesse / base / indicação)  
- [ ] Pergunta aberta (produto / cidade / urgência)  
- [ ] Sem “aprovado” / “liberado” / urgência falsa  
- [ ] Opt-out implícito respeitoso  

### 5.5 O que NÃO fazer

- Mode `AUTO_SEND` no piloto financeira  
- Gerar D0 com campanha PAUSED/DRAFT  
- Estourar cap diário “para acabar a lista”  
- Reenviar D0 no mesmo lead (Protection / First Touch bloqueiam)

---

## 6. Como usar Recovery

### 6.1 Quando age

Só **após** First Touch (lead `CONTACTED`/`RESPONDED` com `lastOutboundAt`).  
**Nunca** em `NEW` frio.

### 6.2 Configuração piloto

UI: `/ai/recovery` (ou settings AI recovery)

| Param | Valor |
|-------|-------|
| Enabled | ON |
| maxAttempts | **2–3** |
| Cadence | ~D1 / D3 / D7 (24 / 72 / 168h) |
| Janela | Comercial |
| Stop on reply | ON |
| Stop on human takeover | ON |
| Stop LOST / CONVERTED / suppress | ON |

### 6.3 Papel na financeira

| Dia | Ação Recovery | Humano |
|-----|---------------|--------|
| D1 | Lembrete suave | Só se SUGGESTED exigir approve (policy) |
| D3 | Novo ângulo (benefício / pergunta) | Revisar se volume baixo |
| D7 | Última tentativa consultiva | Depois: deixar / LOST se pedir |

### 6.4 Compliance Recovery

- Mesmas regras de copy do D0.  
- Se cliente pedir para parar → `LOST` + suppress.  
- COMPLAINT / HUMAN → handoff, sem mais proactive.

---

## 7. Como usar HOT Leads

### 7.1 Definição operacional

Lead **HOT** quando:

- `Lead.score ≥ 70` **e/ou**  
- Purchase Intent `HIGH` / `VERY_HIGH` (11E)  

Idealmente após **resposta inbound** (não pontuar lista fria).

### 7.2 Fila do closer (rotina)

```text
Manhã / tarde:
  1. Abrir Pipeline / Leads filtrando score alto / QUALIFIED / RESPONDED
  2. Abrir Lead Workspace: Memory · Score · Intent · NBA · Objections
  3. Prioridade:
       VERY_HIGH / HIGH intent → ligar ou WA humano já
       HOT score + engajado → closer
       WARM → IA continua / Recovery
  4. Pedir docs só após encaixe (produto + faixa + urgência)
  5. Analista de crédito FORA do Autopilot
  6. Marcar CONVERTED ou LOST no CRM
```

### 7.3 O que o closer NÃO faz

- Caçar lead NEW sem D0  
- Reescrever FAQ que a KB já cobre  
- Prometer aprovação  
- Ignorar `agentPaused` / handoff  

### 7.4 Handoff IA → humano

Triggers típicos: AUTHORITY, COMPLAINT, pedido HUMAN, deal complexo, HOT parado.  
Closer assume a Conversation; Recovery/AUTO param.

---

## 8. Como medir resultado em 30 dias

### 8.1 Funil (semanal + D30)

| KPI | Meta qualitativa piloto* |
|-----|--------------------------|
| Leads importados | Conforme base (ex. 80–200 no mês) |
| First-touch enviados | 15–25/dia útil × dias ativos |
| Reply rate | ≥ 8–15% (calibrar vertical) |
| HOT / respostas | Tendência ↑ após KB + copy |
| Convertidos atribuídos | ≥ baseline pré-Autopilot; ideal uplift via Recovery |
| Incidentes compliance / ban | **0** graves |

\*Metas são **hipóteses de piloto**, não SLA contratual.

### 8.2 Cadência de medição

| Checkpoint | Olhar |
|------------|-------|
| **D7** | WA estável? Reply rate D0? Copy rejeitada? Caps ok? |
| **D14** | Recovery gerando reply? HOT chegando no closer? KB gaps? |
| **D30** | Convertidos · receita estimada · ROI · FTE · go/no-go |

### 8.3 Atribuição (alinhada Fase 12)

```text
Lead ∈ Campaign
  + First Touch EXECUTED
  + Conversation
  + CONVERTED no período
→ conversão atribuída à campanha
```

Receita estimada = `convertidos × ticket_médio × margem%`.

### 8.4 Baseline (obrigatório D0)

Antes de ligar campanhas, registrar 2–4 semanas anteriores (mesmo que manual):

- leads/mês  
- reply rate aproximado  
- conversões  
- headcount WA dedicada  

Sem baseline, D30 vira storytelling.

---

## 9. Quais dashboards acompanhar

| Dashboard | Path / superfície | Quem | Frequência |
|-----------|-------------------|------|------------|
| **Empresa / CRM** | `/dashboard` | OWNER | Diário rápido |
| **Campanhas** | `/outbound/campaigns` (+ detalhe) | OWNER/ADMIN | Diário ops |
| **First Touch** | `/outbound/first-touch` | Ops | Diário (approve) |
| **Protection** | `/outbound/protection` | ADMIN | Diário caps |
| **Import** | `/outbound/import` | Ops | Em cada lote |
| **Recovery** | `/ai/recovery` | ADMIN | 2–3×/semana |
| **IA / Sales Brain** | `/ai/dashboard` | OWNER/Closer lead | Diário |
| **Pipeline / Leads** | `/pipeline`, `/leads` | Closer | Contínuo |
| **Conversas** | `/conversations` | Closer | Contínuo |
| **Scorecard Revenue** | Conceito Fase 12 (`/revenue` futuro) | OWNER | D7/D14/D30 (planilha se UI ainda não existir) |

### 9.1 Ritual diário (15 min)

1. Caps Protection restantes.  
2. SUGGESTED First Touch a aprovar.  
3. Reply/HOT novos.  
4. Handoffs / reclamações.  
5. 1 ajuste de KB se copy falhou.

### 9.2 Ritual semanal (45 min)

1. Funil da campanha RUNNING.  
2. Reply / HOT / convert rates.  
3. Opt-outs e erros Evolution.  
4. Decisão: manter / pausar / trocar copy.  
5. Atualizar planilha ROI/FTE.

---

## 10. Como calcular ROI

Fórmula operacional (Revenue Intelligence design §2):

```text
Receita_atribuída = convertidos_atribuídos × ticket_médio × margem%

Custo_outbound ≈
  (horas_ops × custo_hora)
  + (horas_closer_HOT × custo_hora_closer)
  + (msgs × custo_canal)
  + custo_LLM_estimado

ROI = (Receita_atribuída − Custo_outbound) / Custo_outbound
```

### 10.1 Exemplo numérico (ilustrativo)

| Input | Valor |
|-------|-------|
| Convertidos atribuídos (30d) | 8 |
| Ticket médio | R$ 5.000 |
| Margem | 40% |
| Receita_atribuída | 8 × 5000 × 0,4 = **R$ 16.000** |
| Custo ops+closer+canal+LLM | **R$ 4.000** |
| ROI | (16000−4000)/4000 = **+3,0x** |

### 10.2 Regras

- Só contar convertidos **com** D0 de campanha (§8.3).  
- Ticket/margem = inputs do champion (estimativa até ERP).  
- Exibir “estimado” no relatório D30.  
- ROI negativo + reply bom → problema de fechamento/ticket, não só de copy.

---

## 11. Como calcular economia de funcionários

Alinhado a Fase 12 Savings + vertical financeira.

### 11.1 O que medir

| Métrica | Definição prática |
|---------|-------------------|
| Atendimentos automatizados | Conversas com D0/Recovery/respostas IA antes de handoff |
| Tempo economizado | Baseline humano − minutos humanos reais (aproves + handoffs) |
| FTE substituído | Horas economizadas / horas úteis FTE no período |
| R$ economizado | Horas × custo/hora |

### 11.2 Faixas esperadas (piloto 30 dias)

| Horizonte | FTE liberado (atendimento) | Nota |
|-----------|----------------------------|------|
| D0–D14 | **0,3–0,7 FTE** | ASSIST + approve ainda humano |
| D15–D30 | **0,5–1,0 FTE** | Recovery + FAQ; closer foca HOT |
| Maduro (pós-piloto) | **1,5–2,5 FTE** | Com KB boa + AUTO FAQ — ver vertical design |

**Não prometer:** eliminação do analista de crédito nem do closer.

### 11.3 Narrativa de venda do piloto

> “Operamos o mesmo volume com **menos tempo de SDR no WhatsApp**; o closer fala só com HOT; o analista continua no crédito.”

---

## 12. Checklist D0–D30

### D0 — Kickoff (setup)

- [ ] OWNER provisionado e company criada  
- [ ] WhatsApp `CONNECTED` + smoke inbound/outbound  
- [ ] Usuários ADMIN/AGENT ativos  
- [ ] Protection ON (caps 20–40/dia)  
- [ ] AI ASSIST; Recovery ON (2–3 attempts)  
- [ ] First Touch `HUMAN_APPROVE` + playbook `financeira`  
- [ ] KB mínima 12+ entradas publicadas e revisadas  
- [ ] Baseline pré-piloto registrado (leads, conversões, headcount)  
- [ ] Inputs ticket/margem/custo-hora anotados  
- [ ] Treino closer 2h concluído  
- [ ] Go/no-go lista: **sem** lista fria  

### D1 — Primeiro lote

- [ ] Import lote pequeno (≤50)  
- [ ] Campanha A criada + attach-import  
- [ ] READY → RUNNING  
- [ ] Generate ≤15 D0 → review humano → approve  
- [ ] Conferir Protection não bloqueou indevido  
- [ ] 0 incidentes de copy irregular  

### D2–D3

- [ ] Ritmo diário 15–25 D0 (se reply ok)  
- [ ] Ajustar KB a partir de rejects  
- [ ] Closers respondendo engajados  
- [ ] Opt-outs tratados (LOST + suppress)  

### D7 — Checkpoint 1

- [ ] WA estável  
- [ ] Reply rate D0 medido  
- [ ] Recovery já elegível para CONTACTED silenciosos  
- [ ] Decisão: manter caps / pausar / reescrever D0  
- [ ] Atualizar planilha funil  

### D8–D13

- [ ] Campanha B (Meta) só se houver fonte limpa  
- [ ] Fila HOT em uso diário pelo closer  
- [ ] Primeiros CONVERTED/LOST registrados no CRM  
- [ ] Avaliar AUTO FAQ (ainda opcional)  

### D14 — Checkpoint 2

- [ ] Recovery → reply medido  
- [ ] HOT rate sobre respostas  
- [ ] Gaps de KB fechados  
- [ ] Calibrar caps (só ↑ se qualidade ok)  
- [ ] Rascunho ROI parcial  

### D15–D29

- [ ] 1 campanha RUNNING por vez (disciplina)  
- [ ] Ritual diário 15 min + semanal 45 min  
- [ ] Analista recebe só casos triados  
- [ ] Incidentes Evolution/compliance = 0  

### D30 — Retrospectiva go/no-go

- [ ] Funil completo: importados → FT → replies → HOT → convertidos  
- [ ] Receita estimada + ROI (§10)  
- [ ] FTE / R$ economizado (§11)  
- [ ] Lista de melhorias KB/copy/processo  
- [ ] Decisão: **continuar** / **ajustar** / **pausar outbound**  
- [ ] NÃO iniciar blast, multi-número, vault ou AUTO_SEND D0 sem novo go  

---

## Playbook operacional condensado (1 página)

```text
CONFIGURAR
  Company → WA → Users → Protection ON → AI ASSIST → Recovery ON
  First Touch HUMAN_APPROVE (financeira) → KB pack → smoke test

ALIMENTAR
  Planilha opt-in → Import → Campaign attach → READY

OPERAR (diário)
  RUNNING → generate lote pequeno → humano aprova D0
  Caps Protection → fila HOT closer → CONVERTED/LOST
  Silêncio → Recovery D1/D3/D7

MEDIR
  D7 reply · D14 HOT/Recovery · D30 ROI + FTE
  Dashboards: Campaigns · First Touch · Protection · AI · Pipeline

PARAR SE
  Lista fria · promessa de aprovação · cap estourado · ban risk · 0 review humano no D0
```

---

## Papéis RACI (piloto)

| Atividade | OWNER | ADMIN/Ops | AGENT Closer | Analista | Ops Autopilot |
|-----------|-------|-----------|--------------|----------|---------------|
| Setup company/WA | A | C | I | I | R (provisionamento) |
| KB | A | R | C | C | C |
| Import + Campaign | A | R | I | I | C |
| Approve First Touch | C | R | C | I | I |
| Atender HOT | I | C | R | I | I |
| Crédito / docs finais | I | I | C | R | I |
| ROI D30 | A | R | C | I | C |

R=responsible · A=accountable · C=consulted · I=informed

---

## Fora deste package (PARAR)

- Código, migrations, APIs novas  
- Campaign Builder avançado / A/B / warm-up / multi-número  
- Cofre de documentos / bureau / formalização  
- Substituição do analista de crédito  
- Implementação Fase 12 (usar fórmulas aqui em planilha até haver produto)

---

## Critérios de aceite deste design

- [x] Configuração do zero  
- [x] KB mínima  
- [x] Campanhas iniciais  
- [x] Import  
- [x] First Touch  
- [x] Recovery  
- [x] HOT Leads  
- [x] Medição 30 dias  
- [x] Dashboards  
- [x] ROI  
- [x] Economia de funcionários  
- [x] Checklist D0–D30  
- [x] Playbook operacional  
- [x] Somente design  

**PARAR.**
