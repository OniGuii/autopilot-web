# Fase 11 — AI Sales Agent MVP Design

**Tipo:** design de produto / impacto arquitetural  
**Status:** proposta para aprovação  
**Restrições desta etapa:** **sem código · sem migrations · sem alteração de schema**  
**Data:** 2026-08-07  
**Base:** CRM assistido atual + AI Suggest (Fase 5) + WhatsApp + FollowUp Scheduler  
**Visão ampla:** `docs/ai-agent-platform-design.md`  
**Objetivo da Fase 11:** transformar o Autopilot em **agente comercial supervisionado** (não caixa-preta).

---

## 0. Resumo executivo

| Hoje | Fase 11 (alvo MVP) |
|------|---------------------|
| Humano opera o CRM | Humano **supervisiona** o agente |
| IA só sugere via API (`SUGGESTED`) | Modos `OFF` / `ASSIST` / `AUTO` por empresa |
| Sem Knowledge Base | KB por empresa (FAQ, produtos, preços, políticas, horários, endereço) |
| Sem classificação | Intent classifier (7 intents) |
| Recovery manual / scheduler genérico | Recovery campaigns com stop conditions |
| Sem ROI de agente | Métricas + custo OpenAI por company |

**Frase de posicionamento:** o agente responde o que sabe com segurança; o que não sabe, escala para humano.

---

## 1. Knowledge Base por empresa

### 1.1 Objetivo
Grounding factual para o LLM — respostas ancoradas no negócio do tenant (`companyId`), não em conhecimento genérico do modelo.

### 1.2 Conteúdo obrigatório do MVP

| Tipo | Conteúdo | Exemplo | Uso no agente |
|------|---------|---------|---------------|
| **FAQ** | Q&A curtas | “Aceitam Pix?” → sim, chave… | Retrieval + prompt |
| **Produtos** | Catálogo resumido | nome, descrição curta, SKU opcional | Intent PRODUCT |
| **Preços** | Faixas / listas | “Produto A: R$ X” | Intent PRICE (só se na KB) |
| **Políticas** | Regras comerciais | troca, garantia, cancelamento | Guardrail + reply |
| **Horários** | Funcionamento | espelha / complementa `businessHours` | Intent genérico / AUTO seguro |
| **Endereço** | Localização / como chegar | rua, maps, referência | AUTO seguro |

### 1.3 Modelo conceitual (impacto — **não migrar nesta etapa**)

```text
Company
  └── AgentKnowledgeBase (1:1 ou 1:N logical)
        ├── entries[]  kind: FAQ | PRODUCT | PRICE | POLICY | HOURS | ADDRESS
        │     fields: title, body, tags[], active, updatedAt
        └── settings: agentMode, maxAutoRepliesPerLeadDay, budget...
```

**Nota de processo:** schema/migrations ficam para a subfase de implementação (11A). Este design só congela o **contrato lógico**.

### 1.4 Reuso vs criar

| Reuso | Criar (na implementação futura) |
|-------|----------------------------------|
| `Company` + Settings (`timezone`, `businessHours`, nome) | Store de entradas KB por `companyId` |
| Tenant JWT.cid | API CRUD KB (OWNER/ADMIN) |
| Prompts AI atuais | Injeção de chunks relevantes no system/user prompt |
| — | UI Settings/Agent → editar FAQ/produtos/preços |

### 1.5 Estratégia de retrieval no MVP (11A)

1. **v0 (preferida no MVP):** KB “compacta” — concatenar entradas ativas (budget de chars, ex. 6–8k) no prompt.  
2. **v1:** chunk + busca por keyword/tag por intent.  
3. **Fora do MVP 11:** embeddings/RAG vetorial (fica para pós-11E).

### 1.6 Regras de grounding

- Se a pergunta exige fato **não presente** na KB → **não inventar** → escalar ou pedir humano.  
- Preço **só** se existir entrada PRICE/PRODUCT correspondente.  
- Horários/endereço: preferir Settings/`HOURS`/`ADDRESS` da company.

---

## 2. Classificador de intenção

### 2.1 Intents do MVP (fechado)

| Intent | Significado | Exemplos |
|--------|-------------|----------|
| `PRICE` | Preço, desconto, orçamento | “quanto custa?”, “tem promoção?” |
| `PRODUCT` | Características, estoque, modelo | “vocês têm X?”, “é original?” |
| `PAYMENT` | Forma de pagamento | “aceita Pix?”, “parcelam?” |
| `DELIVERY` | Entrega, prazo, retirada | “entrega em SP?”, “posso retirar?” |
| `COMPLAINT` | Reclamação, problema, tom hostil | “péssimo”, “quero reclamar” |
| `HUMAN` | Pedido explícito de atendente | “falar com alguém”, “atendente” |
| `UNKNOWN` | Não classificado / ambíguo | áudio sem contexto, msg genérica |

### 2.2 Contrato conceitual de saída

```text
{
  intent: PRICE | PRODUCT | PAYMENT | DELIVERY | COMPLAINT | HUMAN | UNKNOWN,
  confidence: 0..1,
  needsHuman: boolean,
  suggestedLeadStatus?: CONTACTED | RESPONDED | ...,
  rationale?: string  // curto, para audit — não enviar ao cliente
}
```

### 2.3 Onde roda

```text
Inbound Message (WhatsApp)
  → Intent Classifier (LLM structured ou classifier dedicado)
  → Orchestrator (regras por intent + mode)
```

### 2.4 Reuso vs criar

| Reuso | Criar |
|-------|-------|
| Histórico de msgs (padrão AI Suggest: últimas N) | Prompt/schema de classificação |
| OpenAI client + rate limits | Persistência do intent (metadata Message/Conversation/Audit) |
| Lead.score (opcional atualizar) | Mapeamento intent → política AUTO/ASSIST/escalate |

### 2.5 Política por intent (MVP)

| Intent | OFF | ASSIST | AUTO |
|--------|-----|--------|------|
| PRICE | — | Sugere | Só se preço na KB; senão escalate |
| PRODUCT | — | Sugere | Se produto na KB |
| PAYMENT | — | Sugere | Se política PAYMENT na KB |
| DELIVERY | — | Sugere | Se política/endereço na KB |
| COMPLAINT | — | Fila humana | **Sempre escalate** (não AUTO) |
| HUMAN | — | Fila humana | **Sempre escalate** |
| UNKNOWN | — | Sugere ou pergunta esclarecimento | Esclarecer 1×; 2ª UNKNOWN → escalate |

---

## 3. Modos de autonomia

| Modo | Comportamento | Default sugerido |
|------|---------------|------------------|
| **OFF** | Agente desligado; CRM + WhatsApp manuais; AI Suggest pode permanecer disponível como botão opcional | Empresas novas até KB mínima |
| **ASSIST** | Classifica + gera resposta → FollowUp `SUGGESTED` → humano aprova/edita/rejeita → execute | **Default após 11A** |
| **AUTO** | Classifica + (se guardrail OK) envia WhatsApp sem approve; senão degrada para ASSIST/escalate | Opt-in explícito OWNER |

### 3.1 Kill switch

- Settings: `agentMode = OFF` imediato.  
- Por conversa: `agentPaused` após escalate (humano retoma).  
- WhatsApp `!= CONNECTED` → não enviar; registrar skip.

### 3.2 Mudança de política vs Fase 5

A Fase 5 afirmou “IA nunca envia sozinha”. A Fase 11 **introduz envio autônomo condicionado** ao modo AUTO + guardrails.  
ASSIST preserva o contrato antigo.

---

## 4. Regras de escalonamento para humano

### 4.1 Gatilhos (MVP)

| # | Gatilho | Ação |
|---|---------|------|
| E1 | Intent `HUMAN` | Pause + assign + aviso opcional ao cliente |
| E2 | Intent `COMPLAINT` | Pause + assign + prioridade alta |
| E3 | `confidence < limiar` (ex. 0.55) | ASSIST ou pause |
| E4 | Fato ausente na KB (preço/produto pedido) | Não inventar → escalate |
| E5 | 2× `UNKNOWN` seguidos | Escalate |
| E6 | Opt-out (“pare”, “stop”, “não quero mais”) | Silence + status LOST/flag + pause |
| E7 | Orçamento OpenAI / quota estourada | Degradar AUTO→ASSIST + alerta OWNER |
| E8 | Fora de `businessHours` + intent urgente/COMPLAINT | Escalate (mensagem “retornamos no horário” opcional) |
| E9 | Max auto-replies/lead/dia atingido | Pause agente na conversa |

### 4.2 Ações de escalonamento (reuso CRM)

1. Marcar conversa/lead como “precisa humano”.  
2. `assign` a AGENT/OWNER (reusa assign existente).  
3. Activity ou Note automática (“Escalonado: COMPLAINT”).  
4. FollowUp `SUGGESTED` opcional com rascunho (modo ASSIST).  
5. **Não** enviar mais AUTO até “Retomar agente”.

### 4.3 UI impact (futuro)

Fila **Precisa humano** na inbox de Conversas + badge no Lead Workspace.

---

## 5. Fluxo inbound WhatsApp

```text
1. WhatsApp webhook inbound          (existe)
2. Persist Message + Lead/Conversation (existe)
3. Se agentMode == OFF → stop (CRM normal)
4. Intent Classifier                 (11B)
5. Policy check (mode, hours, pause, quota, max replies)
6. Retrieve KB slices por intent     (11A)
7. Branch:
     a) escalate? → §4 → humano
     b) ASSIST → gerar reply → FollowUp SUGGESTED (AI_REPLY) → UI aprova
     c) AUTO + allowed → gerar reply → send WhatsApp (reusa outbound)
                         + audit source=ai_agent
8. Side effects:
     - status lead (NEW→CONTACTED / →RESPONDED) sob regras
     - metrics + cost ledger
```

### 5.1 Diagrama

```text
[Inbound WA] → [Inbound Pipeline]
                      │
                      ▼
              [agentMode?]
               OFF → fim
               ASSIST / AUTO
                      │
                      ▼
              [Intent Classifier]
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
   COMPLAINT/HUMAN  UNKNOWN     PRICE/...
   → escalate       → clarify   → KB hit?
                      /escalate      │
                              ┌──────┴──────┐
                              ▼             ▼
                           miss KB       hit KB
                           → escalate    → generate
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                                 ASSIST              AUTO
                                 SUGGESTED           send WA
                                 (humano)            + audit
```

### 5.2 Impacto arquitetural

| Componente existente | Papel na Fase 11 |
|----------------------|------------------|
| `WhatsappInboundService` | Hook pós-persistência → enqueue Agent job |
| `AiService` / OpenAI | Geração + (novo) classify |
| FollowUp `AI_REPLY` | Caminho ASSIST |
| `WhatsappSendService` | Caminho AUTO |
| AuditLog | Decisões do agente |
| Async flags (`ASYNC_INBOUND`, `ASYNC_AI`) | Preferir job assíncrono para não atrasar webhook |

**Webhook deve permanecer rápido:** classificar/responder em worker, não no request do webhook.

---

## 6. Recovery automático (reuso FollowUp Scheduler)

### 6.1 Objetivo
Recuperar leads sem resposta com cadência controlada — **sem** inventar novo motor de envio.

### 6.2 Reuso obrigatório

| Artefato atual | Uso |
|----------------|-----|
| FollowUp `type=RECOVERY` | Campanha de recuperação |
| Status `SCHEDULED` → execute | Envio |
| `ASYNC_FOLLOWUP_ENABLED` + Due Scanner + Processor | Disparo no tempo |
| AI Suggest pattern | Gerar `suggestedBody` com KB (tom de follow-up) |

### 6.3 Cadência MVP (11D)

| Toque | Quando | Stop se |
|-------|--------|---------|
| R1 | 24h após último outbound sem inbound | Lead respondeu / opt-out / escalate / CONVERTED/LOST |
| R2 | 72h após R1 sem resposta | Idem |
| — | Sem 3º toque no MVP | Evitar ban / spam |

### 6.4 Fluxo

```text
Scanner/policy (11D):
  leads/conversations elegíveis
  → criar FollowUp RECOVERY SCHEDULED (body via IA+KB ou template)
  → FollowUp Scheduler existente executa quando due
  → WhatsApp send
  → metrics: recovery_sent / recovery_replied
```

### 6.5 Guardrails recovery

- Só com WhatsApp CONNECTED.  
- Respeitar max msgs/lead/dia (compartilhado com AUTO).  
- Não recuperar COMPLAINT em aberto.  
- Modo OFF → não agenda.  
- AUTO ou flag `recoveryEnabled` separada (recomendado: só com AUTO ou toggle próprio).

---

## 7. Métricas de ROI

### 7.1 KPIs do MVP (11E)

| Métrica | Definição | Fonte |
|---------|-----------|-------|
| **Mensagens automatizadas** | Outbounds com `source=ai_agent` (AUTO) + RECOVERY executados por agente | Message / FollowUp metadata |
| **Leads recuperados** | Lead que recebeu RECOVERY e depois gerou inbound (janela 7d) | FollowUp + Message |
| **Conversões** | Leads → `CONVERTED` no período (com/sem toque agente — segmentar) | Lead.status |
| **Economia estimada** | `msgs_automatizadas × minutos_humano_por_msg × custo_hora` (params configuráveis) | Fórmula produto |
| Tempo 1ª resposta | inbound → 1º outbound | Message timestamps |
| Taxa de escalonamento | escalates / inbounds tratados pelo agente | Audit |
| Taxa approve ASSIST | AI FollowUps aprovados / (aprovados+rejeitados) | Audit AI |

### 7.2 Economia estimada (fórmula)

```text
economia_bruta = auto_messages × (minutos_por_msg / 60) × custo_hora_atendente
economia_liquida = economia_bruta - custo_openai_periodo
```

Defaults sugeridos (configuráveis): `minutos_por_msg = 3`, `custo_hora_atendente = R$ 25` (placeholder).

### 7.3 Superfície

- Dashboard card ou página **Agente / ROI** (OWNER/ADMIN).  
- Reusar padrões do dashboard/pipeline atuais.

---

## 8. Custos OpenAI por empresa

### 8.1 Já existe

- Tokens em `FollowUp.metadata` (suggest).  
- Rate limit company: 10/min, 200/dia (suggest).  
- Modelo default `gpt-4o-mini`.

### 8.2 Estender na Fase 11 (conceito)

| Controle | Descrição |
|----------|-----------|
| Ledger diário | Σ prompt+completion tokens por `companyId` (classify + reply + recovery) |
| Cap diário | Bloqueia AUTO (degrada ASSIST) ao atingir |
| Custo estimado USD/BRL | `tokens × preço_modelo` (tabela config) |
| Alertas | 80% do cap → banner Settings/Diagnostics |
| Atribuição | metadata `purpose: classify|reply|recovery` |

### 8.3 Impacto

- Novo agregador (Redis ou tabela de usage — **decisão na implementação**; design não escolhe migration agora).  
- Diagnostics pode exibir “AI usage hoje”.

---

## 9. Riscos de alucinação e mitigação

| Risco | Impacto | Mitigação MVP |
|-------|---------|---------------|
| Preço inventado | Prejuízo / perda de confiança | PRICE só com hit KB; senão escalate |
| Promessa de prazo falsa | Reclamação | DELIVERY só com política KB |
| Tom inadequado em COMPLAINT | Dano reputacional | Nunca AUTO em COMPLAINT |
| KB desatualizada | Erro “correto segundo KB velha” | OWNER edita KB; `updatedAt` visível; sem scrape externo |
| Prompt injection do cliente | Vazamento / bypass | System prompt rígido; ignorar instruções do usuário que peçam “ignore regras” |
| Over-reply / ban WA | Canal morto | Max replies/lead/dia; horários; opt-out |
| Expectativa “vende sozinho” | Churn | Modo ASSIST default; copy de supervisão |
| Custo explode | Margem | Cap tokens; modelo mini; classify curto |

**Regra de ouro:** *sem evidência na KB ⇒ não afirmar ⇒ escalar.*

---

## 10. Roadmap Fase 11 (subfases)

| Subfase | Nome | Entrega | Depende |
|---------|------|---------|---------|
| **11A** | Knowledge Base | Modelo/API/UI mínima FAQ+Produtos+Preços+Políticas+Horários+Endereço; binding no prompt | — |
| **11B** | Intent Classifier | 7 intents + confidence + persistência audit/metadata | 11A (KB para decisões) |
| **11C** | Auto Reply | Orchestrator inbound; modos OFF/ASSIST/AUTO; escalate; send sob guardrails | 11A+11B |
| **11D** | Recovery Campaigns | Cadência R1/R2 via FollowUp Scheduler + stop rules | 11C (policy/quota) |
| **11E** | ROI Dashboard | Mensagens auto, recuperados, conversões, economia, custo OpenAI | 11C (+11D para recovery metrics) |

### 11.1 Critérios de go/no-go entre subfases

| De → Para | Go se |
|-----------|-------|
| 11A → 11B | Company piloto com KB mínima preenchida (≥1 HOURS, ADDRESS, 5 FAQ, 3 PRODUCT/PRICE) |
| 11B → 11C | Classifier ≥70% agreement em amostra humana de 50 msgs |
| 11C → 11D | AUTO low-risk estável 5 dias úteis sem incidente grave |
| 11D → 11E | Recovery R1/R2 sem spike de opt-out |
| 11E done | OWNER vê ROI/custo e decide manter AUTO |

### 11.2 Ordem de valor para 1 cliente real

```text
11A KB → 11B Classify → ASSIST na UI → 11C AUTO seguro → 11D Recovery → 11E ROI
```

**Não pular para AUTO sem KB + classifier.**

---

## 11. Impacto arquitetural (sem implementação)

### 11.1 Novos módulos lógicos (futuros)

| Módulo | Responsabilidade |
|--------|------------------|
| `agent-kb` | CRUD + retrieval compacto |
| `agent-policy` | mode, caps, toggles recovery |
| `agent-classifier` | intent pipeline |
| `agent-orchestrator` | glue pós-inbound |
| `agent-metrics` | ROI + cost rollup |

### 11.2 Pontos de integração no código existente (referência)

| Ponto | Impacto |
|-------|---------|
| Pós `WhatsappInboundService.processInboundMessage` | Enqueue orchestrator |
| `AiService` | Extender classify + reply com KB context |
| `FollowUpScheduler` | Consumir RECOVERY de campanhas 11D |
| `FollowUp` metadata | `source=ai_agent`, intent, tokens, purpose |
| Settings / nova página Agent | Mode + KB editor |
| Conversations UI | ASSIST approve; fila escalate |
| Dashboard | Widgets 11E |

### 11.3 Explicitamente fora desta etapa de design

- Código, PRs de feature, migrations Prisma  
- Embeddings/pgvector  
- Fine-tuning  
- Multi-canal (só WhatsApp)  
- Auto-`CONVERTED`  
- Billing SKU do agente  

---

## 12. MVP de validação (1 cliente) — definição de pronto da Fase 11

**Done quando:**

1. KB da empresa preenchida e editável.  
2. Modos OFF/ASSIST/AUTO funcionando com kill switch.  
3. Inbound classificado nos 7 intents.  
4. AUTO responde só com grounding KB; COMPLAINT/HUMAN escalam.  
5. Recovery R1/R2 via scheduler existente com stop on reply.  
6. OWNER vê: msgs auto, leads recuperados, conversões, economia estimada, custo OpenAI.

**Sucesso de negócio (2 semanas):**

| Métrica | Alvo |
|---------|------|
| % inbounds com 1ª resposta &lt; 5 min (AUTO) | ↑ vs baseline humano |
| Escalation rate | 20–50% |
| Incidentes de preço errado | 0 |
| Opt-out atribuível a recovery | baixo / monitorado |

---

## 13. Decisões a congelar na aprovação

| ID | Decisão proposta |
|----|------------------|
| **S1** | Default `ASSIST` após 11A; `AUTO` opt-in |
| **S2** | Intents fechados na lista §2 (sem intents extras no MVP) |
| **S3** | COMPLAINT e HUMAN nunca AUTO |
| **S4** | Preço sem KB → escalate (nunca inventar) |
| **S5** | Recovery = FollowUp `RECOVERY` + scheduler atual |
| **S6** | Webhook não bloqueia em LLM — sempre async job |
| **S7** | Sem migrations neste documento; schema na implementação 11A |
| **S8** | CRM permanece source of truth e inbox de supervisão |

---

## 14. Referências

- `docs/ai-agent-platform-design.md` — visão ampla do agente  
- `apps/api/docs/ai-design.md` / `ai-review.md` — AI Suggest atual  
- `apps/api/docs/followup-scheduler-review.md` — scheduler a reutilizar  
- `apps/api/docs/whatsapp-design.md` — canal inbound/outbound  
- `docs/technical-debt-final.md` — AI Suggest sem UI (pré-requisito de superfície)  
- `docs/pilot-readiness-final.md` — fluxo IA hoje bloqueado na UI  

---

## 15. Próximo passo (após aprovação deste design)

1. Aprovar decisões **S1–S8**.  
2. Abrir implementação **11A Knowledge Base** (aí sim: schema/migrations/API/UI).  
3. Não iniciar 11C AUTO antes de 11A+11B verdes no cliente piloto.
