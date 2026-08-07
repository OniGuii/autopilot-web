# AI Agent Platform Design — De CRM assistido a agente comercial autônomo

**Tipo:** arquitetura de produto (somente documentação — sem implementação)  
**Data:** 2026-08-07  
**Público:** product + eng  
**Estado atual do produto:** CRM operacional + WhatsApp + Follow-ups + AI Suggest (API, humano no loop)  
**Estado alvo:** agente comercial autônomo **com guardrails**, por empresa (tenant)

---

## 1. Objetivo

Transformar o Autopilot de:

```text
Humano opera → IA só sugere → Humano aprova → WhatsApp envia
```

para:

```text
Inbound / lead / agenda
  → Agente decide (KB + políticas + modelo)
  → Responde / classifica / atualiza status / agenda recuperação
  → Escala para humano quando o risco ou a regra exigir
```

**Princípio:** autonomia é um **modo configurável por empresa**, não um interruptor global irreversível. O CRM assistido continua existindo como modo seguro.

---

## 2. Mudança de política (crítica)

| Hoje (Fase 5 AI) | Alvo (Agent Platform) |
|------------------|------------------------|
| “A IA **nunca** envia sozinha” (`ai-design.md`) | A IA **pode** enviar dentro de **políticas** (modo, horário, confiança, topics) |
| FollowUp `SUGGESTED` obrigatório | Dois caminhos: **Assistido** (SUGGESTED) e **Autônomo** (auto-approve / auto-execute sob regras) |
| Sem alteração automática de `Lead.status` | Classificador pode propor **e**, se autorizado, aplicar transição |
| Sem Knowledge Base | KB por `companyId` alimenta prompts e grounding |

Toda autonomia exige: **audit trail**, **kill switch**, **escalonamento**, **limites de custo**.

---

## 3. Arquitetura alvo (visão)

```text
                    ┌─────────────────────────────┐
   WhatsApp IN ───► │ Inbound Pipeline (existente) │
                    └──────────────┬──────────────┘
                                   ▼
                    ┌─────────────────────────────┐
                    │ Agent Orchestrator (NOVO)   │
                    │  - mode: OFF|ASSIST|AUTO    │
                    │  - intent + risk + policy   │
                    │  - tools: reply, classify,  │
                    │    status, recover, escalate│
                    └──────┬───────────┬──────────┘
           ┌───────────────┼───────────┼───────────────┐
           ▼               ▼           ▼               ▼
    ┌────────────┐  ┌──────────┐ ┌──────────┐  ┌────────────┐
    │ Knowledge  │  │ LLM      │ │ CRM      │  │ FollowUp / │
    │ Base       │  │ (OpenAI) │ │ Leads /  │  │ WhatsApp   │
    │ (NOVO)     │  │ (existe) │ │ Conv /   │  │ Send       │
    └────────────┘  └──────────┘ │ Timeline │  │ (existe)   │
                                 └──────────┘  └────────────┘
           │                                         │
           └──────────── Audit + Metrics + Cost ─────┘
```

### Camadas

| Camada | Papel |
|--------|-------|
| **Channel** | WhatsApp inbound/outbound (já existe) |
| **Memory / CRM** | Lead, Conversation, Message, FollowUp, Timeline (já existe) |
| **Knowledge** | Documentos/FAQs/ofertas por empresa (novo) |
| **Policy** | Modo autônomo, horários, topics bloqueados, confiança mínima (novo) |
| **Orchestrator** | Decide ação a cada evento (novo) |
| **Tools** | Ações concretas (reply, classify, status, recover, escalate) |
| **Observability** | Audit, custo tokens, ROI (parcial → expandir) |

---

## 4. O que já existe e pode ser reutilizado

| Capacidade | Onde | Reuso no agente |
|------------|------|-----------------|
| WhatsApp connect / QR / send / webhook | `whatsapp/*` | Canal do agente |
| Inbound → lead/conversa/mensagem | `WhatsappInboundService` | Trigger principal do agente |
| Outbound send + delivery | `WhatsappSendService` / delivery | Tool `send_reply` |
| AI Suggest → FollowUp `SUGGESTED` `AI_REPLY` | `ai/*`, prompts, OpenAI client | Núcleo de geração; estender para auto-path |
| Rate limit AI (10/min, 200/dia) + lock | `ai.constants` / service | Base de guardrails de custo |
| Metadata AI (model, tokens, promptVersion) | FollowUp.metadata | Custos e auditoria |
| FollowUp lifecycle approve/execute/retry | `follow-up/*` | Envio controlado; scheduler due |
| Scheduler `ASYNC_FOLLOWUP_ENABLED` | BullMQ followup-scheduler | Recuperação automática no tempo |
| Async AI worker flag | `ASYNC_AI_ENABLED` | Geração fora do request |
| Lead status + assign + notes + activities + timeline | leads / workspace | Estado comercial + handoff humano |
| Audit log | ops/audit | Trilha de decisões do agente |
| Diagnostics / OpenAI check | ops diagnostics | Saúde do agente |
| Multi-tenant `companyId` | JWT.cid / Prisma | Isolamento da KB e políticas |
| Dashboard / pipeline KPIs | dashboard, pipeline | Base para ROI (estender) |
| Settings company | settings | Ancorar Agent Policy + KB flags |

**UI hoje:** CRM assistido forte; **AI Suggest ainda sem botão** na conversa. Autonomia exige UI de política + fila de revisão + handoff.

---

## 5. O que precisa ser criado

| Bloco | Entregáveis novos (conceitual) |
|-------|--------------------------------|
| Knowledge Base | Store por company (docs, FAQ, preços, tom); ingestão; retrieval (RAG leve) |
| Agent Policy | Modo OFF / ASSIST / AUTO; horários; max msgs/lead/dia; topics; confiança |
| Agent Orchestrator | Pipeline pós-inbound e jobs de recovery |
| Classificador | Intent + score + estágio sugerido |
| Status engine | Transições automáticas permitidas + regras |
| Recovery engine | Sequências (D+1, D+3…) com stop on reply |
| Escalation | Regras → assign humano + pausa do agente |
| Cost ledger | Tokens/custo por company/dia + orçamento |
| ROI metrics | Taxa resposta, tempo 1ª resposta, recovery, conversão |
| UI Agent | Policy, KB upload, inbox “precisa humano”, métricas |

---

## 6. Mapeamento dos 10 pilares

### 6.1 Knowledge Base por empresa

**Objetivo:** o agente responde com a verdade daquele negócio (horários, preços, estoque genérico, tom).

| | |
|--|--|
| **Reuso** | `companyId`, Settings (nome/locale/timezone), prompts atuais |
| **Criar** | Entidades KB (documento/chunk), ingestão (PDF/txt/FAQ), embedding ou keyword search MVP, binding no prompt |
| **MVP** | FAQ curto (10–30 Q&A) + “sobre a empresa” colado no system prompt (sem RAG pesado) |

```text
Company
  └── KnowledgeBase
        └── Document (source, status)
              └── Chunk (text, embedding?)
```

**Risco:** alucinação se KB vazia → modo ASSIST obrigatório até KB mínima.

---

### 6.2 Resposta automática via WhatsApp

**Objetivo:** inbound → resposta outbound sem clique humano (quando política permitir).

```text
Webhook inbound (existe)
  → Orchestrator
  → retrieve KB + histórico (20 msgs — já existe padrão)
  → LLM gera reply
  → Policy check (confiança, horário, topic, budget)
       ├─ FAIL → FollowUp SUGGESTED + escalate / fila humana
       └─ PASS → criar Message OUTBOUND + WhatsApp send
                 (ou FollowUp auto-APPROVED/SCHEDULED→execute)
```

| | |
|--|--|
| **Reuso** | Inbound, OpenAI, FollowUp, send WhatsApp, rate limits |
| **Criar** | Modo AUTO; “confidence”; bypass opcional de approve; idempotência por `messageId` inbound |
| **MVP** | AUTO só para intents seguros (saudação, horário, endereço); resto ASSIST |

---

### 6.3 Classificação automática de leads

**Objetivo:** etiquetar intenção/qualidade a cada interação relevante.

| Sinais | Exemplos |
|--------|----------|
| Intent | preço, agendar, reclamação, spam, fora de escopo |
| Temperature | quente / morno / frio |
| Fit | score 0–100 (reusar campo `Lead.score`) |

| | |
|--|--|
| **Reuso** | `Lead.score`, `Lead.source`, status, metadata FollowUp |
| **Criar** | Tool `classify_lead`; schema de labels; job pós-mensagem |
| **MVP** | 5 intents + score; gravar em metadata/timeline; UI badge |

---

### 6.4 Atualização automática de status

**Objetivo:** funil reflete a realidade sem o atendente clicar.

| Evento | Transição sugerida |
|--------|-------------------|
| 1ª mensagem outbound | NEW → CONTACTED |
| Lead respondeu | → RESPONDED |
| Pediu proposta / agendou | → QUALIFIED |
| Fechou negócio (humano confirma) | → CONVERTED |
| Pediu para parar / sem fit | → LOST |

| | |
|--|--|
| **Reuso** | PATCH lead status, timeline/audit, inbound já pode marcar CONTACTED |
| **Criar** | Matriz de transições permitidas ao agente; nunca pular para CONVERTED sem humano no MVP |
| **MVP** | Auto: NEW→CONTACTED→RESPONDED; QUALIFIED/CONVERTED/LOST só humano ou confirmação explícita |

---

### 6.5 Recuperação automática de leads

**Objetivo:** leads frios recebem sequência sem planilha.

```text
Lead IDLE / sem resposta N horas
  → Recovery policy (D+1, D+3, D+7)
  → Gerar FollowUp type=RECOVERY (já existe tipo)
  → SCHEDULED
  → Scheduler (já existe se flag ON) → WhatsApp
  → Stop se inbound chegar / opt-out / escalate
```

| | |
|--|--|
| **Reuso** | FollowUp `RECOVERY`, scheduler due, AI suggest pattern |
| **Criar** | Cadência por company; stop conditions; max toques |
| **MVP** | 2 toques (24h e 72h) após último outbound sem reply |

---

### 6.6 Escalonamento para humano

**Objetivo:** o agente sabe a hora de calar a boca.

**Gatilhos (MVP):**
- Intent: reclamação, jurídico, preço custom complexo, pedido humano
- Confiança LLM baixa
- Cliente pediu “falar com pessoa”
- 3 falhas de entendimento
- Fora de horário + urgência
- Orçamento AI estourado

**Ação:**
1. Pausar AUTO na conversa (`agentPaused=true`)
2. Assign lead/conversa a AGENT/OWNER
3. Criar Activity / nota “Escalonado: motivo”
4. Notificar (in-app; e-mail depois)
5. Opcional: mensagem “Vou te transferir para um atendente”

| | |
|--|--|
| **Reuso** | assign/unassign, activities, notes, roles AGENT |
| **Criar** | estado de pausa do agente por conversa; fila “Precisa humano” na UI |
| **MVP** | pausa + assign + badge na inbox |

---

### 6.7 Limites e guardrails

| Guardrail | MVP | Depois |
|-----------|-----|--------|
| Kill switch company | Policy mode OFF | + por conversa |
| Modo ASSIST default | Sim | AUTO opt-in |
| Horário comercial (Settings) | Respeitar open/close | Fuso já existe |
| Max msgs agente / lead / dia | 3 | Configurável |
| Max tokens / company / dia | Estender rate 200/dia | Orçamento $ |
| Denylist topics | Preço ilegal, medical, etc. | Lista por vertical |
| PII / opt-out | “pare/parar/stop” → LOST + silence | LGPD formal |
| Idempotência inbound | Por webhook message id | Já há base webhook |
| Humano sempre pode assumir | Assign + pause | — |
| Sem auto-CONVERTED | Sim | — |

**Fail closed:** erro OpenAI / KB faltando / WA disconnected → não envia; cria SUGGESTED ou fila humana.

---

### 6.8 Custos OpenAI

| Já existe | Falta |
|-----------|-------|
| Tokens em FollowUp.metadata | Ledger agregado por company/dia |
| Rate 10/min e 200/dia | Cap em **USD** e alerta 80% |
| Modelo default `gpt-4o-mini` | Roteamento: classificar mini / reply mini / casos hard → modelo maior |
| Stub só em test | Dashboard custo no Diagnostics/Settings |

**Fórmula ROI custo (conceitual):**

```text
custo_dia ≈ Σ (promptTokens + completionTokens) × preço_modelo
CAC_mensagem = custo_dia / msgs_agente_enviadas
```

**MVP:** somar usage do metadata + quota diária; bloquear AUTO ao estourar (cair para ASSIST).

---

### 6.9 Métricas de ROI

| Métrica | Como obter |
|---------|------------|
| Tempo até 1ª resposta | inbound → 1º outbound (agente ou humano) |
| % conversas com resposta &lt; 5 min | messages |
| Taxa de recuperação | RECOVERY executados → lead RESPONDED |
| Taxa de escalonamento | pauses / conversas AUTO |
| Aprovação humana (modo ASSIST) | approve vs reject AI FollowUps (audit já parcialmente) |
| Conversão | leads → CONVERTED no período |
| Custo AI / lead tocado | ledger ÷ leads touched |
| Deflexão | % resolvidas sem humano |

**Reuso:** dashboard/pipeline; **criar:** agent_metrics snapshot diário + painel “ROI do agente”.

---

### 6.10 Roadmap em fases

| Fase | Nome | Resultado | Autonomia |
|------|------|-----------|-----------|
| **A0** | Assist UI | Botão “Sugerir IA” + aprovar/executar na UI | Humano 100% |
| **A1** | KB mínima + Policy | FAQ/empresa + modos OFF/ASSIST/AUTO (AUTO off) | Pronto para ligar |
| **A2** | Auto-reply seguro | AUTO em intents low-risk + escalate | Parcial |
| **A3** | Classify + status | Score/intent + NEW→CONTACTED→RESPONDED | Parcial |
| **A4** | Recovery cadences | D+1/D+3 com scheduler | Parcial |
| **A5** | Cost + ROI | Ledger, cap $, painel | Operação |
| **A6** | RAG / vertical packs | KB rica, playbooks por segmento | Alta |

Cada fase tem kill switch e critério de go/no-go com 1 cliente real.

---

## 7. Modos de operação (produto)

| Modo | Comportamento |
|------|----------------|
| **OFF** | CRM puro; IA desligada |
| **ASSIST** | Gera SUGGESTED; humano aprova (comportamento atual + UI) |
| **AUTO** | Envia nos casos permitidos; escala no resto |
| **AUTO+RECOVERY** | AUTO + cadências (fase A4) |

Recomendação de venda inicial: **ASSIST** default; **AUTO** só após KB preenchida + 48h de ASSIST com taxa de aprovação alta.

---

## 8. Riscos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Alucinação / preço errado | Perda de confiança / prejuízo | KB obrigatória; denylist; ASSIST default |
| Spam / ban WhatsApp | Canal morto | Max msgs/lead; opt-out; horário |
| Loop agente ↔ cliente | Custo + UX ruim | Max turns; escalate |
| Custo OpenAI explode | Margem negativa | Cap diário; modelo mini; bloquear AUTO |
| LGPD / consentimento | Jurídico | Opt-out; retenção; não treinar em dados do cliente sem contrato |
| Auto-status errado | Funil mentiroso | Poucas transições automáticas no MVP |
| Expectativa “vende sozinho” | Churn | Copy: agente com supervisão; métricas honestas |
| WA instável | Agente inútil | Diagnostics + pause AUTO se disconnected |
| Mudança da política “nunca envia” | Regressão de confiança interna | Feature flag + audit + rollback 1 clique |

---

## 9. MVP mínimo para validar com 1 cliente real

**Hipótese:** com KB mínima + AUTO em 2–3 intents seguros + escalonamento, o tempo de 1ª resposta cai e o time só pega casos difíceis.

### Escopo do MVP (sim)

1. **UI Suggest (ASSIST)** na conversa — sem isso ninguém valida qualidade  
2. **KB mínima:** texto “Sobre nós” + 15 FAQs (mesmo coladas em Settings no v0)  
3. **Policy:** OFF / ASSIST / AUTO; horário; max 3 msgs agente/lead/dia  
4. **Auto-reply** só para: saudação, horário de funcionamento, endereço/como chegar  
5. **Escalate** para: preço complexo, reclamação, “quero atendente”, confiança baixa  
6. **Status auto:** NEW→CONTACTED no 1º outbound; →RESPONDED no inbound após contato  
7. **Recovery off** no MVP (manual/ASSIST) — evita ban na 1ª semana  
8. **Custo:** quota diária + log de tokens (metadata já ajuda)  
9. **Métrica semanal:** tempo 1ª resposta, % escalado, % approve em ASSIST, msgs agente

### Fora do MVP (não)

- RAG/embeddings complexos  
- CONVERTED automático  
- Cadência recovery multi-toque  
- Multi-agente / voz  
- Fine-tuning  
- Billing do agente como SKU (pode ser depois)

### Critério de sucesso (2 semanas com 1 cliente)

| Métrica | Alvo sugerido |
|---------|----------------|
| WhatsApp CONNECTED estável | ≥ 90% do horário comercial |
| % intents cobertos pelo AUTO | ≥ 30% dos inbounds |
| Tempo mediano 1ª resposta (AUTO) | &lt; 2 min |
| Taxa de escalonamento | 20–50% (se 0% = perigoso; se 90% = AUTO inútil) |
| Reclamações por resposta errada | ≤ 2/semana |
| Aprovação humana no modo ASSIST (amostra) | ≥ 70% |

**No-go:** ban WA, alucinação de preço, custo AI &gt; valor do piloto.

### Sequência de rollout no cliente

```text
Semana 0: ASSIST only + preencher KB + medir approve rate
Semana 1: AUTO low-risk intents + fila “Precisa humano”
Semana 2: revisar erros → ajustar FAQs → decidir se liga recovery (A4)
```

---

## 10. Decisões de desenho recomendadas

| ID | Decisão |
|----|---------|
| **AD1** | Autonomia é **opt-in por company** (default ASSIST) |
| **AD2** | Todo envio AUTO gera audit + metadata `source=ai_agent` |
| **AD3** | CONVERTED / descontos agressivos **nunca** automáticos no MVP |
| **AD4** | Recovery usa FollowUp `RECOVERY` + scheduler existente |
| **AD5** | KB v0 pode ser “documentos texto em Settings”; RAG na A6 |
| **AD6** | Kill switch global na UI Settings (mode OFF) |
| **AD7** | Custo: estourar quota → degrada AUTO→ASSIST, não silêncio total sem avisar |
| **AD8** | Humano assign pausa agente na conversa até “retomar” |

---

## 11. Relação com o CRM atual

O CRM **não morre**. Ele vira:

- **Painel de supervisão** do agente  
- **Inbox humana** para escalados  
- **Source of truth** de leads/status  
- **Modo fallback** quando AUTO está off  

Isso evita o produto virar “caixa-preta que manda WhatsApp”.

---

## 12. Resumo executivo

| Pergunta | Resposta |
|----------|----------|
| O que reutilizar? | WhatsApp, inbound/outbound, AI Suggest, FollowUp, scheduler, leads/timeline, audit, quotas |
| O que criar? | KB, Policy, Orchestrator, classify/status tools, escalation queue, cost ledger, ROI, UI agente |
| Maior risco? | Alucinação + ban WhatsApp + expectativa de “vende sozinho” |
| MVP 1 cliente? | ASSIST UI + KB curta + AUTO só intents seguros + escalate + status básico + métricas — **sem recovery multi-toque** |

---

## Referências

- `apps/api/docs/ai-design.md` / `ai-review.md` — AI Suggest atual (humano no loop)  
- `apps/api/docs/followups-design.md` / `followup-scheduler-review.md` — motor de recuperação  
- `apps/api/docs/whatsapp-design.md` — canal  
- `docs/pilot-readiness-final.md` — IA hoje BLOQUEADA na UI  
- `docs/business-readiness-audit.md` — contexto SaaS  
- `docs/technical-debt-final.md` — AI suggest sem tela (P0 de superfície)
