# Fase 11E — Sales Brain Design

**Tipo:** design de produto / orquestração comercial  
**Status:** proposta para aprovação — **aguardar go antes de implementar**  
**Restrições desta etapa:** **sem código · sem migrations · sem alteração de schema · sem PR de implementação**  
**Data:** 2026-08-08  
**Branch de design:** `cursor/ai-sales-agent-11e-design-dd93`  
**Base implementada:** 11A KB · 11B Intent · 11C AUTO supervisionado · 11D Recovery Engine  
**Designs relacionados:** `docs/ai-sales-agent-mvp-design.md`, `docs/ai-agent-platform-design.md`

---

## 0. Mudança de posicionamento

| Documento original (MVP §10) | Esta proposta (11E) |
|------------------------------|---------------------|
| 11E = ROI Dashboard (economia, custo OpenAI) | 11E = **Sales Brain** — conduzir venda supervisionada |
| Foco em métricas financeiras do agente | Foco em **estágio comercial + memória + ação** |
| ROI como entrega única | ROI / receita estimada entram no **AI Sales Dashboard** (item 8); ledger OpenAI detalhado pode ser 11E.x ou pós-11E |

**Frase de posicionamento:**

```text
Hoje (11A–11D):  Cliente pergunta → IA responde (FAQ/KB seguro) + recovery.
11E (alvo):      Cliente pergunta → IA conduz uma venda (descobrir → qualificar → fechar/escalar).
```

A IA **não** deve agir como FAQ. Deve descobrir necessidades, qualificar, tratar objeções, conduzir o próximo passo e gerar oportunidade — **sempre supervisionada** (ASSIST default; AUTO só com guardrails + estágio permitido).

---

## 1. Sales Stages (estágios internos do agente)

### 1.1 Estágios propostos

Estágios são **estado interno do Sales Brain por conversa** — não substituem `LeadStatus` do CRM. Servem para decidir Next Best Action, tom e o que pode ser AUTO.

| Stage | Objetivo do agente | Sinais típicos de entrada | Saídas típicas |
|-------|--------------------|---------------------------|----------------|
| **DISCOVERY** | Entender contexto e necessidade | 1º contato, pergunta genérica, “quero saber mais” | Perguntas abertas; mapear produto/cidade |
| **QUALIFICATION** | Validar fit (budget, urgência, autoridade) | Já há interesse mínimo; faltam dados BANT-lite | Perguntas de qualificação; score sobe |
| **INTEREST** | Aprofundar oferta alinhada | Produto/preço discutidos; engajamento ativo | Proposta leve, comparativo, prova social KB |
| **OBJECTION** | Tratar resistência sem pressão | “caro”, “preciso pensar”, “falo com sócio” | Objection Engine; não insistir no mesmo ângulo |
| **PURCHASE_INTENT** | Facilitar fechamento | “quero comprar”, “como pago”, “manda link” | CTA claro / link / pagamento KB; ou HANDOFF |
| **HANDOFF** | Passar a humano com contexto | COMPLAINT, HUMAN, deal complexo, score alto + risco | `agentPaused`; brief para atendente |
| **CONVERTED** | Encerrar ciclo de venda do agente | Lead `CONVERTED` no CRM | Parar recovery/AUTO; celebrar / onboarding curto opcional |

### 1.2 Relação com `LeadStatus` atual

`LeadStatus` continua a **fonte de verdade operacional do CRM**. Sales Stage é camada paralela (conversa). Mapeamento **sugerido** (não automático cego):

| LeadStatus | Sales Stages compatíveis | Notas |
|------------|--------------------------|-------|
| **NEW** | DISCOVERY | Ainda sem outbound significativo; agente pode só preparar 1ª abordagem |
| **CONTACTED** | DISCOVERY → QUALIFICATION | Outbound feito; aguarda ou conduz descoberta |
| **RESPONDED** | DISCOVERY → QUALIFICATION → INTEREST → OBJECTION | Cliente falou; estágio depende da memória/score |
| **QUALIFIED** | INTEREST → OBJECTION → PURCHASE_INTENT | Fit já marcado no CRM; agente acelera proposta |
| **CONVERTED** | CONVERTED | Para agent send/recovery (já em 11D) |
| **LOST** | — (terminal) | Para agent; opcional win-back fora do MVP 11E |

```text
LeadStatus (CRM, humano/regras)     SalesStage (agente, por Conversation)
───────────────────────────────     ────────────────────────────────────
NEW ──────────────┐                 DISCOVERY
CONTACTED ────────┤                 QUALIFICATION
RESPONDED ────────┼──► influenciam ► INTEREST
QUALIFIED ────────┤                 OBJECTION
                  │                 PURCHASE_INTENT
CONVERTED ────────┴──► força ─────► CONVERTED / HANDOFF
LOST ─────────────► para agente
```

### 1.3 Regras de transição (conceitual)

1. Transições de stage são **monotônicas preferenciais** (avançar), com regressão controlada (ex.: INTEREST → OBJECTION).  
2. `COMPLAINT` / pedido HUMAN → **HANDOFF** imediato (já alinhado a 11C).  
3. Sinais de compra fortes → **PURCHASE_INTENT** mesmo se LeadStatus ainda for RESPONDED.  
4. Atualizar `LeadStatus` (ex. → QUALIFIED) só com **política explícita** e audit — default 11E.1–11E.4: **sugerir** status, não mutar sozinho; 11E.5 pode optar por auto-QUALIFIED sob score threshold + ASSIST/AUTO policy.

### 1.4 Persistência do stage (conceito — sem schema nesta etapa)

Ver §2: campo lógico `salesStage` na Sales Memory da conversa + audit `AI_SALES_STAGE_CHANGED`.

---

## 2. Sales Memory (memória comercial por conversa)

### 2.1 Objetivo

Manter um **estado comercial acumulado** para a IA não reiniciar a venda a cada mensagem (e para Recovery 11D continuar o contexto).

### 2.2 Campos lógicos (MVP)

| Campo | Tipo lógico | Exemplo | Uso |
|-------|-------------|---------|-----|
| `salesStage` | enum stage | `QUALIFICATION` | Orquestração |
| `budget` | string \| number \| null | `"até 500"`, `499` | Qualificação / objeção preço |
| `productInterest` | string[] \| null | `["Plano Pro"]` | Oferta alinhada |
| `urgency` | `LOW\|MEDIUM\|HIGH\|null` | `HIGH` | Priorizar CTA |
| `city` | string \| null | `"Campinas"` | Entrega / cobertura KB |
| `paymentPreference` | string \| null | `"Pix"`, `"3x"` | Fechamento |
| `lastObjection` | objection code \| null | `CARO` | Objection Engine |
| `objectionCount` | int | `2` | Anti-loop de pressão |
| `purchaseSignals` | string[] | `["como_pago"]` | 11E.5 |
| `score` | 0–100 | `72` | Espelho do scoring (ou deriva de Lead.score) |
| `nextBestAction` | enum NBA | `ASK_BUDGET` | Última decisão |
| `version` | int | `5` | Versionamento otimista |
| `updatedAt` | ISO datetime | — | Freshness |
| `sourceMessageIds` | uuid[] (últimos N) | — | Provenance / audit |

### 2.3 Onde armazenar (opções — decisão na implementação)

| Opção | Onde | Prós | Contras | Recomendação |
|-------|------|------|---------|--------------|
| **A — Conversation.metadata** (JSON) | Já existe `Conversation` | Zero migration se metadata flexível; tenant-safe | Queries agregadas mais difíceis; tamanho JSON | **Preferida no 11E.1** para velocidade |
| **B — Lead.metadata / campos score** | `Lead.score` já existe (0–100 int) | Score CRM visível no pipeline | Memória é por conversa; lead pode ter N conv | Score espelhado; memória na conversa |
| **C — Tabela `ConversationSalesMemory`** | Nova 1:1 | Tipagem, índices, RLS | Migration + modelo | **11E.2+** se A ficar apertado |

**Decisão de design (congelar intenção):**  
- **11E.1:** memória em `Conversation` (metadata lógico `salesMemory`) + espelho de `score` em `Lead.score` quando mudar ≥Δ.  
- Schema formal (opção C) só se product/eng aprovarem após 11E.1 — **fora deste documento de aprovação inicial**.

### 2.4 Como persistir

```text
Inbound processado
  → classificar intent (11B)
  → extrair/atualizar slots da memória (LLM structured ou regras)
  → merge patch (só campos com confiança ≥ limiar)
  → version++
  → audit AI_SALES_MEMORY_UPDATED (before/after patch)
  → calcular score + NBA
  → gerar resposta / FollowUp / AUTO
```

**Regras de merge:**

- Nunca apagar slot com valor “mais específico” por um “null” de baixa confiança.  
- Objeção nova sobrescreve `lastObjection` e incrementa `objectionCount`.  
- Recovery (11D) **lê** memória; não zera slots.

### 2.5 Versionamento

| Mecanismo | Descrição |
|-----------|-----------|
| `version` monotônico | Cada patch +1; write com check `version` (otimista) |
| Audit append-only | `AI_SALES_MEMORY_UPDATED` com diff |
| Prompt snapshot | Ao gerar reply, incluir `salesMemory` vN no contexto (budget de chars) |
| Retenção | Sem soft-delete próprio; segue Conversation soft-delete |

---

## 3. Lead Scoring (0–100)

### 3.1 Objetivo

Priorizar fila humana, decidir agressividade do NBA, filtrar Recovery e alimentar dashboard.

### 3.2 Modelo

- Escala **0–100** (alinhada a `Lead.score` existente).  
- Score do Sales Brain é a **fonte sugerida**; CRM `Lead.score` é o espelho persistido.  
- Cálculo **determinístico + eventos** (não só “feeling” do LLM): eventos auditáveis.

### 3.3 Eventos que sobem score (exemplos)

| Evento | Δ sugerido | Notas |
|--------|------------|-------|
| Intent PRICE | +8 | Perguntou preço |
| Intent PAYMENT | +12 | Perguntou pagamento |
| Pedido de proposta / orçamento | +15 | Regex/LLM slot |
| Intent DELIVERY + cidade informada | +6 | Fit logístico |
| Respondeu Recovery (inbound ≤7d após AI_RECOVERY) | +10 | Já parcialmente em 11D “recovered” |
| Entrou PURCHASE_INTENT | +20 (cap) | Sinal forte |
| LeadStatus → QUALIFIED (humano) | +10 | Confirmação humana |

### 3.4 Eventos que reduzem score

| Evento | Δ sugerido | Notas |
|--------|------------|-------|
| Silêncio após R2/R3 recovery | −8 | Friagem |
| Intent COMPLAINT | −25 + HANDOFF | Não empurrar venda |
| Negativa explícita (“não quero”, “pare de mandar”) | −40 / clamp 0 + stop recovery | Opt-out comportamental |
| Objeção repetida 3× sem avanço | −10 | Evitar pressão |
| `agentPaused` / HUMAN | score freeze | Humano assume |

### 3.5 Faixas operacionais

| Score | Label | Comportamento agente |
|-------|-------|----------------------|
| 0–29 | Frio | DISCOVERY leve; Recovery cauteloso |
| 30–59 | Morno | QUALIFICATION; ASSIST preferido |
| 60–79 | Quente | INTEREST / OBJECTION; AUTO só low-risk |
| 80–100 | Compra | PURCHASE_INTENT; preferir HANDOFF se ticket alto / policy |

### 3.6 Anti-gaming

- Cap por dia por lead (ex. +30/dia).  
- Mesmo intent repetido: Δ decrescente.  
- Score não autoriza sozinho promessa fora da KB.

---

## 4. Objection Engine

### 4.1 Catálogo MVP

| Código | Exemplos de fala | Tratamento |
|--------|------------------|------------|
| **CARO** | “tá caro”, “fora do orçamento” | Reframe valor com KB PRICE/PRODUCT; perguntar budget; **nunca** inventar desconto |
| **SEM_TEMPO** | “agora não”, “depois” | Agendar FollowUp / horário; baixar urgência; Recovery respeita cooldown |
| **PRECISO_PENSAR** | “vou pensar”, “me dá um tempo” | 1 pergunta de destravamento (“o que falta para decidir?”); não spam |
| **VER_COM_SOCIO** | “preciso falar com sócio/esposa” | Pedir o que levar na conversa; oferecer resumo/proposta; HANDOFF se B2B complexo |
| **COMPARANDO_CONCORRENTE** | “vi mais barato no X” | Diferenciação só com fatos KB; perguntar critério decisivo; sem denegrir |

### 4.2 Fluxo de tratamento

```text
Detectar objeção (classificador dedicado ou intent+slots)
  → salesStage = OBJECTION
  → lastObjection = CODE
  → NBA = HANDLE_OBJECTION(code)
  → Resposta: 1) empatia curta  2) fato KB  3) 1 pergunta / 1 CTA
  → Se objectionCount ≥ 3 sem avanço → HANDOFF
  → Se COMPLAINT misturado → HANDOFF imediato
```

### 4.3 Guardrails

- Sem “fechamento agressivo” em OBJECTION (tom consultivo).  
- Desconto / condição especial: **só** se existir na KB; senão escalar.  
- Recovery não reenvia a mesma objeção ignorada com o mesmo ângulo (variar ou parar).

### 4.4 Extensão de intents (conceito)

Pode permanecer como **sub-label** em metadata (`objectionCode`) sem novo enum Prisma na primeira fatia; enum formal é decisão de implementação.

---

## 5. Next Best Action (NBA)

### 5.1 Princípio

Após **cada** mensagem inbound (e antes de cada Recovery send):

> O agente deve ter **um objetivo claro**. Nunca encerrar a conversa sem próximo passo (pergunta, CTA, agendamento ou handoff).

### 5.2 Catálogo de ações

| NBA | Quando | Canal de execução |
|-----|--------|-------------------|
| `ASK_NEED` | DISCOVERY sem productInterest | Pergunta aberta |
| `ASK_BUDGET` | QUALIFICATION sem budget | Pergunta |
| `ASK_URGENCY` | Fit parcial | Pergunta |
| `ASK_CITY` | DELIVERY sem city | Pergunta |
| `SHARE_OFFER` | INTEREST + KB hit | Resposta grounded |
| `SEND_PROPOSAL` | Score ≥60 + dados mínimos | Texto proposta / FollowUp |
| `HANDLE_OBJECTION` | OBJECTION | Objection Engine |
| `PUSH_CHECKOUT` | PURCHASE_INTENT | Pagamento/link KB |
| `SCHEDULE_FOLLOWUP` | SEM_TEMPO / silêncio previsto | FollowUp SCHEDULED (reuse) |
| `ESCALATE_HUMAN` | HANDOFF / risco | FollowUp SUGGESTED + pause |
| `STOP` | LOST / opt-out / CONVERTED | Cancel recovery; sem outbound |

### 5.3 Mecanismo de decisão (camadas)

```text
1. Hard rules (COMPLAINT, HUMAN, LOST, agentPaused, mode OFF)
2. Sales stage + missing slots (memória)
3. Score band
4. Last objection / anti-loop
5. KB availability (sem fato → não afirmar → perguntar ou escalar)
6. Mode ASSIST vs AUTO (AUTO só NBAs low-risk allowlist)
```

### 5.4 Contrato lógico de saída do orquestrador

```text
{
  salesStage,
  score,
  nextBestAction,
  replyGoal: string,          // "descobrir budget"
  suggestedBody?: string,     // ASSIST/AUTO
  requiresHuman: boolean,
  suggestedLeadStatus?: LeadStatus,
  memoryPatch?: object
}
```

### 5.5 Relação com pipeline atual (11C)

| Hoje | 11E |
|------|-----|
| Intent → KB → reply ou escalate | Intent → **Memory patch** → **Score** → **Stage** → **NBA** → KB/reply/escalate |
| AUTO allowlist por intent | AUTO allowlist por **intent ∩ NBA ∩ stage** |
| Recovery gera lembrete por intent | Recovery usa **NBA + memória** (não blast genérico) |

---

## 6. Purchase Signals

### 6.1 Sinais (exemplos)

| Sinal | Exemplos | Peso |
|-------|----------|------|
| `WANT_BUY` | “quero comprar”, “fechamos”, “pode reservar” | Alto |
| `HOW_PAY` | “como pago”, “aceita Pix”, “parcelamento” | Alto |
| `DELIVERY_CLOSE` | “tem entrega”, “quando chega”, “frete pra…” | Médio-alto |
| `SEND_LINK` | “manda o link”, “como faço o pedido” | Alto |
| `CLOSE_NOW` | “vamos fechar”, “pode emitir”, “manda o pix” | Crítico |

### 6.2 Quando converter

| Condição | Ação |
|----------|------|
| Pagamento/pedido **confirmado no canal** + política empresa | Sugerir ou (policy) setar `LeadStatus.CONVERTED` + stage CONVERTED |
| Só sinal verbal sem confirmação | Permanecer PURCHASE_INTENT; NBA `PUSH_CHECKOUT` ou `ESCALATE_HUMAN` |
| Ticket / risco alto (config) | **Nunca** auto-CONVERT — HANDOFF |

**Default 11E:** conversão CRM continua **humana ou regra explícita**; agente registra oportunidade e facilita.

### 6.3 Quando escalar

- Sinal crítico + KB sem procedimento de checkout.  
- Pedido fora da política (desconto custom, contrato).  
- COMPLAINT durante fechamento.  
- Score ≥80 e empresa config `handoffOnHotLead=true`.

### 6.4 Quando registrar oportunidade

Conceito de **Opportunity** (lógico):

```text
Opportunity {
  companyId, leadId, conversationId,
  stage: PURCHASE_INTENT | ...,
  estimatedValue?: number,  // de budget/KB price
  currency: company.currency,
  source: ai_sales_brain,
  signals[],
  createdAt
}
```

**Persistência na 1ª fatia:** audit `AI_OPPORTUNITY_OPENED` + metadata conversa — **sem** tabela obrigatória até aprovação. CRM Opportunity formal = pós-11E se necessário.

---

## 7. Recovery Integration (11D)

### 7.1 Princípios

| Regra | Detalhe |
|-------|---------|
| Continuar contexto | Recovery lê Sales Memory; mensagem usa stage/score/objeção |
| Não reiniciar venda | Proibido tom de “primeiro contato” se já houve DISCOVERY+ |
| Respeitar score | Score baixo → cadência mais lenta / copy soft; score alto → ângulo de fechamento (ainda com stop on reply) |
| Respeitar objeção | Se `lastObjection=SEM_TEMPO`, Recovery agenda com NBA `SCHEDULE_FOLLOWUP`, não “só passando” genérico |
| Stop conditions 11D | Mantém: reply, takeover, converted, lost, maxAttempts |

### 7.2 Ajustes conceituais no Recovery

```text
prepareExecution (11D)
  → carregar salesMemory
  → se stage HANDOFF/CONVERTED → stop
  → se score < threshold company → skip ou soft template
  → gerar body com NBA + memória (não só intent seed)
  → enviar source=ai_recovery
```

### 7.3 Métrica cruzada

- “Receita recuperada” no dashboard = convertidos/tocados pós-recovery (já esboçado em 11D) × valor estimado da memória/KB.

---

## 8. AI Sales Dashboard

### 8.1 Superfície

- Rota proposta: `/ai/sales` (ou evolução de `/ai/dashboard`).  
- Roles: OWNER/ADMIN.  
- Complementa Dashboard IA (11C) e Recovery (11D); não os remove.

### 8.2 Métricas

| Métrica | Definição | Fonte lógica |
|---------|-----------|--------------|
| **Leads qualificados** | Leads que atingiram stage QUALIFICATION+ ou LeadStatus QUALIFIED no período | Memory / Lead |
| **Objeções** | Contagem por código + taxa de superação (saiu de OBJECTION → INTEREST/PURCHASE) | Memory / Audit |
| **Conversões** | Lead → CONVERTED (segmentar com/sem toque agente / recovery) | Lead + Message source |
| **Escalamentos** | AI_ESCALATED / HANDOFF | Audit |
| **Receita estimada** | Σ estimatedValue de oportunidades abertas/ganhas (budget ou preço KB) | Memory / Opportunity lógico |
| **Receita recuperada** | Subconjunto atribuído a AI_RECOVERY (janela 7d + convertido) | 11D + conversões |

### 8.3 ROI herdado do MVP §7 (opcional nesta fase)

Manter cards de mensagens automatizadas, economia estimada e custo OpenAI como **fase 11E.x / addendum**, para não bloquear Sales Brain. Se aprovado no mesmo epic, entram como seção “Eficiência”.

### 8.4 APIs conceituais

```text
GET /api/ai/sales/dashboard
GET /api/ai/sales/memory/:conversationId   (OWNER/ADMIN/AGENT assigned)
```

---

## 9. Riscos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| **Alucinação** (preço, prazo, desconto) | Prejuízo / processo | Grounding KB obrigatório; sem fato → perguntar/escalar (regra de ouro 11A–11C) |
| **Pressão excessiva** | Opt-out, ban WA, marca | Cap objection loops; tom consultivo; ASSIST default; horários; max AUTO/recovery |
| **Spam** | Bloqueio canal | Reusar guardrails 11C/11D; NBA `STOP` em negativa; cooldown |
| **Promessas indevidas** | Chargeback / reclame | Deny-list de frases; POLICY KB; audit de outbound |
| **Falsos positivos de compra** | Lead “quente” falso; handoff inútil | Thresholds + confirmação; não auto-CONVERT; humano em ticket alto |
| **Memória errada** | Oferta errada | Confiança por slot; UI de correção humana; version/audit |
| **Stage drift** | Loops DISCOVERY infinitos | Timeouts → HANDOFF ou Recovery; max turns por stage |
| **Privacidade** | PII em memória | Mesmo tenant RLS; não logar PII demais em Prometheus |

---

## 10. Roadmap de implementação (após aprovação)

> **Não implementar agora.** Fatias abaixo são o plano pós-aprovação.

### 10.1 Visão das fatias

| Fatia | Nome | Entrega | Esforço* | Risco | ROI |
|-------|------|---------|----------|-------|-----|
| **11E.1** | Sales memory | Modelo lógico + persistência Conversation metadata + audit + leitura no pipeline ASSIST/AUTO | **M** — toca pipeline e UI conversa | Médio (dados errados) | Alto — base de tudo |
| **11E.2** | Lead scoring | Motor de eventos 0–100 + espelho `Lead.score` + faixas | **S–M** — regras + testes | Baixo–médio | Alto — priorização |
| **11E.3** | Objection engine | Catálogo + detecção + tratamento + anti-loop | **M** — prompts/regras + KB | Médio (tom) | Alto — destravar deals |
| **11E.4** | Next best action | Orquestrador stage→NBA→reply; never idle | **M–L** — coração do Sales Brain | Alto (comportamento) | Muito alto |
| **11E.5** | Purchase intent | Sinais, oportunidade, regras convert/escalate; dashboard sales | **M** — sinais + dashboard | Médio–alto (falsos +) | Muito alto |

\*Esforço relativo de engenharia (S/M/L), não calendário.

### 10.2 Dependências

```text
11E.1 Memory
   └─► 11E.2 Scoring
         └─► 11E.3 Objections ──┐
                               ├─► 11E.4 NBA
         productInterest/slots─┘         └─► 11E.5 Purchase + Dashboard
11D Recovery ──(consome memória/score/NBA a partir de 11E.1/4)
```

### 10.3 Critérios de go/no-go

| De → Para | Go se |
|-----------|-------|
| Aprovação design → 11E.1 | Product assina stages + campos memória + “sem FAQ vazio” |
| 11E.1 → 11E.2 | Memória visível na UI conversa; audit ok; multi-tenant testado |
| 11E.2 → 11E.3 | Score correlaciona com QUALIFIED/CONVERTED em amostra piloto |
| 11E.3 → 11E.4 | Objeções sem spike de opt-out; handoff em loop |
| 11E.4 → 11E.5 | NBA estável 5 dias úteis em ASSIST; AUTO só allowlist |
| 11E.5 done | Dashboard sales usado pelo OWNER; 0 auto-CONVERT indevido |

### 10.4 Fora de escopo 11E

- Tabela Opportunity formal / funil financeiro completo (pode ser 12.x).  
- RAG vetorial.  
- Multi-agente / voice.  
- Alterar enum `LeadStatus`.  
- Remover modos OFF/ASSIST/AUTO.  
- Implementação nesta etapa de design.

### 10.5 Reuso obrigatório

| Artefato | Uso em 11E |
|----------|------------|
| KB + resolver (11A) | Grounding de oferta/objeção/pagamento |
| Intent classifier (11B) | Entrada do orquestrador |
| ASSIST/AUTO + guardrails (11C) | Execução supervisionada |
| Recovery (11D) | Continuação contextual |
| FollowUp Scheduler / WhatsApp send | NBA schedule / send |
| Audit + Prometheus | Observabilidade |
| `Lead.score` | Espelho do score |

---

## 11. Decisões a congelar na aprovação

| ID | Decisão | Opções | Recomendação |
|----|---------|--------|--------------|
| D1 | Onde nasce a memória | A metadata conv / C tabela | **A** no 11E.1 |
| D2 | Auto-update LeadStatus | Nunca / só QUALIFIED / full | **Só sugerir** até 11E.5 policy |
| D3 | Auto-CONVERT | Sim / Não | **Não** no MVP 11E |
| D4 | AUTO + NBA | Allowlist conservadora | Sim — intents low-risk ∩ stages INTEREST/QUALIFICATION |
| D5 | Escopo ROI OpenAI | Dentro 11E.5 / fase aparte | **Addendum** se sobrar capacidade |
| D6 | Nome UI | `/ai/sales` vs expandir dashboard | `/ai/sales` + links cruzados |

---

## 12. Critérios de aceite do *design* (esta etapa)

- [x] Documento único cobrindo stages, memória, score, objeções, NBA, purchase, recovery, dashboard, riscos, roadmap  
- [x] Sem código / migrations / schema alterado  
- [x] Alinhado a 11A–11D e LeadStatus existentes  
- [x] Executive summary separado  
- [ ] **Aprovação humana** antes de qualquer implementação

---

## 13. Próximo passo

**Aguardar aprovação** deste design (e do executive summary).  
Só então abrir branch de implementação `11E.1` — Sales memory — sem pular para NBA/purchase.
