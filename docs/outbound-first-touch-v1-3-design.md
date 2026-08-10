# Design — Outbound V1.3 First Touch Engine

**Tipo:** design (sem código · sem migrations · sem alteração de APIs)  
**Data:** 2026-08-10  
**Branch:** `cursor/outbound-first-touch-v1-3-design-dd93`  
**Base:** Autopilot CRM + WhatsApp (Evolution) + 11C AUTO · 11D Recovery · 11E Sales Brain  
**Documentos relacionados:**  
`docs/outbound-sales-engine-v1-design.md` · `docs/outbound-protection-v1-1-review.md` · `docs/outbound-import-v1-2-review.md` · `docs/ai-sales-agent-11c-review.md` · `docs/ai-sales-agent-11d-review.md` · `docs/ai-sales-agent-11e-design.md` · `docs/financial-services-vertical-design.md`

---

## 0. Veredito

A V1.2 importa leads `NEW` sem Conversation e sem disparo. A V1.1 já protege envios proativos (`outbound_first_touch` reservado). A Recovery 11D **só** age em `CONTACTED|RESPONDED` com `lastOutboundAt`. O Sales Brain 11E e o pipeline 11C **só** conduzem **depois** do reply inbound.

**V1.3 fecha o elo faltante:** transformar Lead importado em conversa WhatsApp com uma única abordagem D0 (first-touch), promover o lead ao mundo Recovery/11E, e parar aí — sem blast, sem motor paralelo.

```text
Import V1.2 (Lead NEW)
  → First Touch V1.3 (Conversation + D0 + CONTACTED + lastOutboundAt)
  → Protection V1.1 (caps / suppress / cooldown)
  → Recovery 11D (D1+)
  → reply inbound → 11C + 11E (qualificação / HOT)
```

**Fora deste documento e da V1.3:** Campaign Engine completo, blast, multi-número, A/B, templates oficiais Meta, scoring avançado de lista, nurture tipado D15 como produto separado.

**Este documento não implementa código, migrations nem APIs.**

---

## 1. Estado atual (o que já existe)

| Peça | Estado | Papel na V1.3 |
|------|--------|---------------|
| Lead Import V1.2 | ✅ | Origem: Lead `NEW` + `metadata.importBatchId` (+ city/product/value/notes) |
| Outbound Protection V1.1 | ✅ | Gate em `outbound_first_touch`; suppress/opt-out/caps |
| Conversation + Message | ✅ | Thread D0; hoje **não** criada no import |
| `WhatsappSendService` | ✅ | Único caminho de envio; atualiza `lastOutboundAt` / `lastContactAt`; **não** promove `NEW→CONTACTED` |
| FollowUp + DueScanner | ✅ | Fila `SUGGESTED` / `SCHEDULED` → execute |
| 11C ASSIST/AUTO + KB + intents | ✅ | Pós-reply (não gera D0 cold sozinho) |
| Recovery 11D | ✅ | D1+ após first-touch; ignora `NEW` sem `lastOutboundAt` |
| Sales Brain 11E | ✅ | Memory/Score/Objection/NBA/Purchase Intent — só inbound |
| Source `outbound_first_touch` | ✅ reservado | Já entra em `isProactiveOutboundSource` |
| Engine First Touch | ❌ | Gap desta fase |

### Gap crítico

```text
Lead importado = NEW, sem Conversation, sem lastOutboundAt
  → Recovery não agenda
  → 11E não roda
  → Send humano/API existe, mas sem lote, sem copy D0, sem side-effect CONTACTED
```

---

## 2. Objetivo do First Touch Engine

Gerar e (conforme modo) **aprovar / enviar** a **primeira abordagem 1:1 (D0)** para leads elegíveis vindos do import (ou `NEW` sem outbound), de forma:

1. Segura (Protection V1.1)  
2. Personalizada (metadata + KB, sem inventar fato)  
3. Idempotente (um D0 por lead/lote)  
4. Compatível com Recovery 11D e Sales Brain 11E  

**Não é:** campanha de blast, segundo Recovery, nem substitute do closer.

---

## 3. Respostas diretas (requisitos)

### 3.1 Como transformar Lead importado em Conversation

**Regra:** no momento de **enfileirar ou executar** o first-touch (não no import), garantir conversa ativa.

```text
1. Lead elegível (NEW, phone ok, não suppress, WA CONNECTED, cap ok)
2. Buscar Conversation do lead com status OPEN | IDLE (canal WHATSAPP)
3. Se existir → reutilizar
4. Se só CLOSED/ARCHIVED ou nenhuma → criar Conversation OPEN (mesmo padrão do inbound)
5. Associar FollowUp / Message a essa conversationId
6. Após send SENT → side-effects no Lead (ver §5)
```

**Não criar Conversation no commit do import** (V1.2 permanece “CRM only”). Conversation nasce com a intenção de contato.

**Idempotência:** no máximo **uma** Conversation `OPEN|IDLE` por lead para o D0; reprocessamento do mesmo lote não cria segunda conversa.

**Referência de código hoje:** criação manual em `ConversationsService.create`; resolve/create inbound em `WhatsappInboundService.resolveOrCreateConversation`. First Touch deve **espelhar** essa semântica (design), sem inventar segundo modelo.

### 3.2 Como gerar a primeira abordagem (D0)

Pipeline conceitual **por lead**:

```text
1. Elegibilidade (§6)
2. Garantir Conversation OPEN|IDLE
3. Montar contexto de personalização:
     Lead.name, company.name,
     metadata (city, product, value, notes),
     source / importBatchId,
     vertical playbook
4. Resolver KB da empresa (§3.3) — grounding opcional (PRICE/PRODUCT/FAQ…)
5. Gerar copy D0:
     A) Template vertical + variáveis (default seguro)
     B) Opcional: LLM curto grounded em KB + slots (nunca inventar preço/aprovação)
6. Validar guardrails de copy (§7)
7. Persistir rascunho no FollowUp type=OUTBOUND_FIRST_TOUCH
8. Modo OFF | HUMAN_APPROVE | AUTO_SEND (§4)
9. Execute → WhatsappSendService (metadata.source=outbound_first_touch)
10. Side-effects + hand-off Recovery (§3.6 / §5)
```

**Comprimento alvo:** ≤ ~500 caracteres.  
**Tom:** 1 pergunta clara + CTA leve. Sem link encurtador duvidoso. Sem CPF/senha/cartão no D0.

Variáveis mínimas: `{nome}`, `{empresa}`, `{produto}`, `{cidade}`, `{valor}`, `{contexto_lista}`.  
Ausência de variável → omitir trecho / fallback curto — **nunca fabricar**.

### 3.3 Como reutilizar KB da empresa

| Aspecto | Design V1.3 |
|---------|-------------|
| Resolver | Reusar `KnowledgeBaseResolver` (11A/11C) — keyword match por kind |
| Intents de grounding D0 | Preferir `PRODUCT` / `PRICE` / `FAQ` alinhados ao playbook; se miss → template puro sem fato sensível |
| O que **não** fazer | AUTO-reply 11C no cold; D0 não depende de inbound |
| Compliance | Sem prometer preço/aprovação/condição sem `bestMatch` KB |
| Vertical | Entradas KB por empresa (já existentes) alimentam parágrafos opcionais (“hoje trabalhamos com…”) |

```text
Template vertical (estrutura)
  + slots do Lead.metadata
  + trecho KB se confidence ≥ limiar (ex. espelhar MIN_CONFIDENCE do resolver)
  − se KB miss em fato obrigatório → mensagem genérica consultiva (sem número inventado)
```

### 3.4 Como reutilizar intents existentes (`AiIntent`)

Intents 11B/11C (`PRICE`, `PRODUCT`, `PAYMENT`, `DELIVERY`, `HOURS`, `ADDRESS`, `COMPLAINT`, `HUMAN`, `UNKNOWN`) são **classificadores de inbound**.

| Fase | Uso de intent |
|------|----------------|
| **Geração D0** | Intent **não** classifica o lead frio. Playbook escolhe *tema* (produto/crédito/visita). Opcionalmente “intent alvo” interno do draft (`PRODUCT` default) só para escolher kind de KB |
| **Pós-reply** | Pipeline 11C classifica a resposta do lead normalmente → KB → ASSIST/AUTO |
| **Escalação** | `COMPLAINT` / `HUMAN` / `UNKNOWN` continuam regras 11C (pause / humano) |

**Não criar** enum paralelo de “outbound intents” na V1.3. Playbook vertical + metadata bastam para D0.

### 3.5 Como reutilizar Sales Brain 11E

| Módulo 11E | No D0 (cold) | Após reply |
|------------|--------------|------------|
| Memory | Pode **semear** slots opcionais a partir do import (`city`, `productInterest` ← metadata.product, `budget` ← metadata.value) **sem** avançar stage artificialmente | Merge normal no inbound |
| Score | Não pontuar lista fria como HOT | Score/temperature após engajamento |
| Objection | N/A | Normal |
| NBA | N/A no D0 (NBA é pós-inbound). Opcional futuro: `SCHEDULE_OUTREACH` — **fora** V1.3 | Conduz pergunta/CTA |
| Purchase Intent | N/A | HOT / HIGH → fila closer |

**Princípio:** First Touch **abre** a conversa; 11E **qualifica** quem responde. Não usar 11E para “autodisparar” D0.

Seed sugerido (design):

```text
Conversation.metadata.salesMemory (opcional no create D0):
  salesStage: DISCOVERY
  city: metadata.city
  productInterest: [metadata.product] se presente
  budget: metadata.value se parseável
  source: outbound_first_touch
```

### 3.6 Como integrar com Recovery 11D

Recovery hoje exige: status `CONTACTED|RESPONDED`, `lastOutboundAt != null`, conversation `OPEN|IDLE`, policy enabled, stops, Protection `ai_recovery`.

**Hand-off V1.3:**

```text
First Touch SENT com sucesso
  → Lead.status NEW → CONTACTED   (side-effect obrigatório — gap atual)
  → Lead.lastOutboundAt / lastContactAt (já feito pelo send)
  → Conversation OPEN|IDLE
  → NÃO criar FollowUp AI_RECOVERY no mesmo instante (deixar scanner 11D)
  → Após cadenceHours[0] sem reply → AiRecoveryScanner agenda R1 normalmente
```

| Tema | Regra |
|------|-------|
| Stop on reply | Inalterado (`stopOnReply`) — inbound cancela recovery |
| Cadência | Perfis por vertical via `CompanyRecoverySettings` (§9) — 1 perfil/company no piloto |
| Cap | Recovery continua gated por Protection (`ai_recovery`) |
| Duplicidade D0 | First Touch **não** agenda se já existe `lastOutboundAt` recente / FollowUp `OUTBOUND_FIRST_TOUCH` pending/executed (policy cooldown) |
| NEW cold | Recovery **permanece** proibido sem first-touch |

---

## 4. Modos de operação

Configuração conceitual (por empresa; override futuro por lote/campanha):

| Modo | Comportamento | Quando usar |
|------|---------------|-------------|
| **OFF** | Engine não gera nem envia D0. Import e Protection seguem ativos. | Default até piloto; empresas sem outbound |
| **HUMAN_APPROVE** | Gera FollowUp `OUTBOUND_FIRST_TOUCH` em `SUGGESTED` → humano aprova → `SCHEDULED` → send | Default recomendado (financeira, solar, imobiliária) |
| **AUTO_SEND** | Gera FollowUp já `SCHEDULED` (ou schedule imediato com jitter) → send sem approve | Só e-commerce / base quente + Protection enabled + caps baixos |

```text
OFF
  → API/UI de “disparar lote” rejeita ou no-op

HUMAN_APPROVE
  → generate drafts (SUGGESTED)
  → fila de aprovação (OWNER/ADMIN/AGENT designado)
  → approve → SCHEDULED (respeita janela + spacing)
  → executeDue → WhatsappSendService

AUTO_SEND
  → generate + SCHEDULED direto
  → mesmos gates Protection
  → audit OUTBOUND_FIRST_TOUCH_AUTO
```

**Notas:**

- `SEMI_AUTO` do design V1 macro **não** entra na V1.3 — reduz superfície; amostragem pode ser processo ops em HUMAN_APPROVE.  
- Modo **não** bypassa suppress/LOST/CONVERTED.  
- Financeira: **proibir** default AUTO_SEND no piloto (policy de produto).

---

## 5. Side-effects obrigatórios no send D0

Após `Message` `SENT` com `source=outbound_first_touch`:

| Efeito | Obrigatório |
|--------|-------------|
| `Lead.lastOutboundAt`, `lastContactAt` | Sim (já no send) |
| `Lead.status`: `NEW` → `CONTACTED` | **Sim (novo na implementação futura)** |
| Não alterar se já `RESPONDED+` | Sim |
| Audit `OUTBOUND_FIRST_TOUCH_SENT` | Sim |
| Métricas Prometheus | Sim |
| Contagem Protection (proactive) | Sim (via gate/send) |
| Seed opcional `salesMemory` DISCOVERY | Recomendado |
| Criar Recovery imediato | **Não** — scanner 11D |

Falha Evolution → FollowUp `FAILED`; **não** promover CONTACTED; retry policy leve (1–2) ou volta para revisão humana.

---

## 6. Elegibilidade e ciclo do job

### 6.1 Elegibilidade por lead

| Check | Regra |
|-------|-------|
| Status | `NEW` (piloto); opcional `CONTACTED` sem `lastOutboundAt` legado |
| Phone | Válido (mesma norma V1.2) |
| Suppress / LOST / CONVERTED | Bloqueia |
| Conversation | Criável / reutilizável OPEN\|IDLE |
| WA | Instance `CONNECTED` |
| Protection | `canSendProactive(outbound_first_touch)` |
| Idempotência | Sem FU `OUTBOUND_FIRST_TOUCH` em SUGGESTED\|SCHEDULED\|EXECUTING\|EXECUTED no escopo do lote (ou cooldown company) |
| Agent mode | `CompanyAiSettings.mode ≠ OFF` se copy LLM; templates puros podem relaxar (policy) |
| Origem | Preferir `metadata.importBatchId` ou filtro explícito de batch |

### 6.2 Estados do lote First Touch (conceitual)

Sem Campaign Engine completo na V1.3 — **lote leve** amarrado a `importBatchId` (ou seleção de leads):

`DRAFT → GENERATING → AWAITING_APPROVAL → QUEUED → SENDING → COMPLETED` (+ `PAUSED` / `CANCELLED` / `FAILED`)

Em `OFF`, o lote não avança além de `DRAFT`.

### 6.3 FollowUp

| Campo | Valor design |
|-------|--------------|
| `type` | `OUTBOUND_FIRST_TOUCH` |
| `status` | `SUGGESTED` (HUMAN_APPROVE) ou `SCHEDULED` (AUTO_SEND) |
| `source` / metadata | `outbound_first_touch` |
| `body` | copy D0 |
| `leadId`, `conversationId` | obrigatórios |

Reusa approve/reject/execute do `FollowUpService` — **sem** segundo scheduler.

---

## 7. Guardrails de geração (copy)

1. Não prometer aprovação de crédito / “pré-aprovado”.  
2. Não inventar preço, taxa, estoque ou disponibilidade sem KB.  
3. Não pedir CPF, senha, cartão ou documentos sensíveis no D0.  
4. Personalizar com slots reais; senão mensagem curta neutra.  
5. Variação leve anti-texto-idêntico (abertura/fechamento), sem spam.  
6. Stop imediato se lead já tiver inbound mais recente que o draft (edge).  
7. Respeitar `agentPaused` se conversa já existir.

---

## 8. Fluxos por vertical

### 8.1 Financeira / consórcios / crédito

**Origem go:** opt-in, base própria, indicação, lead de anúncio. **No-go:** lista fria comprada; copy de crédito aprovado.

```text
Import (source financeiro / metadata valor·produto)
  → Modo HUMAN_APPROVE (obrigatório no piloto)
  → D0 consultivo: interesse + pergunta de valor/produto
  → CONTACTED + lastOutboundAt
  → Recovery CONSERVATIVE (D0 → D3 → D7) via 11D
  → Reply → 11C/11E (TRUST/AUTHORITY → escalate; HOT → closer)
  → Docs/análise fora do Autopilot
```

**Caps piloto:** 20–40 D0/dia · Protection enabled · AUTO_SEND off.

**Exemplo D0:**  
> Oi{, Nome}! Aqui é da {Empresa}. Vi que você pediu informações sobre {produto\|crédito/consórcio}. Posso te explicar as opções — sem compromisso. Qual valor você tem em mente?

### 8.2 Imobiliária

```text
Import (bairro/cidade/tipologia em metadata)
  → HUMAN_APPROVE
  → D0: interesse no bairro + pergunta 2/3 quartos ou faixa
  → Recovery LONG_CYCLE (D3 / D7 [/ D15 config])
  → Reply → 11E ASK_CITY/BUDGET/PRODUCT → HOT → corretor (visita)
```

**Caps:** 30–50/dia. Personalização por bairro é anti-ban e anti-duplicidade de copy.

**Exemplo D0:**  
> Oi{, Nome}! Vi seu interesse em imóveis em {cidade/bairro}. Prefere 2 ou 3 quartos para eu filtrar opções?

### 8.3 Energia solar

```text
Import (consumo kWh, cidade, telhado → metadata)
  → HUMAN_APPROVE
  → D0: economia estimada / diagnóstico (sem inventar kWh)
  → Recovery LONG_CYCLE (D3 / D7 / D15)
  → Reply → 11E BUDGET/CITY/TIME → HOT → consultor
```

**Caps:** 25–40/dia.

**Exemplo D0:**  
> Oi{, Nome}! Aqui é da {Empresa}. Posso te mostrar uma estimativa de economia em {cidade} com base no seu consumo — quer que eu te explique o próximo passo?

### 8.4 E-commerce

```text
Import (carrinho / produto → metadata.product)
  → HUMAN_APPROVE na 1ª semana; AUTO_SEND só com caps + opt-in claro
  → D0: lembrete de produto + CTA condições (KB PRICE/PRODUCT)
  → Recovery STANDARD (D1 / D3)
  → Reply → 11E PRICE→alternativa; HOT→fechamento
```

**Caps:** 40–80/dia se número aquecido.

**Exemplo D0:**  
> Oi{, Nome}! Notei seu interesse em {produto}. Ainda está disponível — quer que eu te passe as condições de pagamento de hoje?

---

## 9. Limites — reutilizar V1.1 (não reinventar)

Todo send D0 usa `metadata.source = outbound_first_touch` → já passa por `OutboundProtectionService.canSendProactive`.

| Controle | Origem | Comportamento no First Touch |
|----------|--------|------------------------------|
| **Caps** diário/horário | V1.1 `dailyProactiveCap` / `hourlyProactiveCap` | Bloqueia ou atrasa enqueue/execute |
| **Spacing** | `minSpacingSeconds` | Jitter entre D0s do lote |
| **Janela horária** | `allowedHours*` | Não agenda fora da janela |
| **Cooldown por lead** | `leadCooldownMinutes` | Evita re-D0 / conflito com recovery |
| **Opt-out keyword** | inbound → suppress | Lead some da elegibilidade |
| **Suppress list** | `OutboundSuppressEntry` | Bloqueia sempre (mesmo Protection disabled) |
| **LOST / CONVERTED** | V1.1 | Bloqueio permanente de proactive |
| **Warm-up** | política ops (§ V1 design) | Caps baixos em número novo — config, não código paralelo |

**Recovery 11D** continua com soft-skip em cap temporário (`OUTBOUND_PROTECTED`) e cancel em suppress permanente — inalterado.

**First Touch V1.3 não cria segunda tabela de caps.**

---

## 10. Dashboard First Touch / Outbound

UI alvo (design): `/outbound/first-touch` (+ cards no rollup outbound).  
Métricas mínimas (janela 7d / 30d, filtro por `importBatchId`):

| Métrica | Definição |
|---------|-----------|
| **Leads importados** | Leads com `metadata.importBatchId` (V1.2) no período |
| **First-touch enviados** | Messages/FollowUps D0 `EXECUTED` / `source=outbound_first_touch` SENT |
| **Responderam** | Contatados com `lastInboundAt` > momento do D0 |
| **Qualificados** | `LeadStatus.QUALIFIED` **ou** score/temperature WARM+ (policy company) |
| **HOT** | temperature HOT e/ou Purchase Intent HIGH/VERY_HIGH (11E) |
| **Convertidos** | `LeadStatus.CONVERTED` no período (atribuição: teve D0 + import/campanha metadata) |

Operacionais: fila SUGGESTED, restantes no cap, erros Evolution, opt-outs, taxa de approve, tempo até reply.

**Fontes:** Lead · FollowUp · Message · Import dashboard · Protection dashboard · 11E score/intent — sem warehouse novo.

---

## 11. Riscos e mitigações

| Risco | Por quê | Mitigação V1.3 |
|-------|---------|----------------|
| **Ban WhatsApp** | Volume + texto idêntico + lista fria | Protection caps; HUMAN_APPROVE; opt-in; personalização; pause em spike de FAILED; warm-up |
| **Mensagens repetidas** | Mesmo template em massa | Variação leve; slots metadata; KB snippet; limite de lote; spacing |
| **Duplicidade** | Reimport + re-D0 + Recovery | Dedupe phone (V1.2); idempotência FU D0; cooldown lead; Recovery só pós-D0; suppress |
| **Baixa conversão** | Lista fria / copy genérica / sem closer | Playbook vertical; KB; 11E pós-reply; fila HOT humana; métricas reply/HOT antes de subir cap |
| **Compliance financeira** | Promessa de crédito | Templates conservadores; KB-only para fatos; AUTO_SEND off; sem CPF no D0 |
| **Gap CONTACTED** | Recovery nunca liga | Side-effect obrigatório NEW→CONTACTED no SENT |
| **Conversa inexistente** | Send falha | Resolve/create Conversation antes do FU |

---

## 12. Observabilidade (design)

**Audits (conceituais):**  
`OUTBOUND_FIRST_TOUCH_GENERATED` · `APPROVED` · `REJECTED` · `SCHEDULED` · `SENT` · `FAILED` · `SKIPPED_PROTECTED` · `MODE_CHANGED` · `BATCH_*`

**Prometheus (conceituais):**  
`outbound_first_touch_generated_total` · `approved_total` · `sent_total` · `failed_total` · `skipped_total{reason}` · gauge fila SUGGESTED

**Ops:** alinhar com Protection (remaining daily/hourly) e Import (batch de origem).

---

## 13. Permissões

| Ação | Roles |
|------|-------|
| Ver dashboard / fila | OWNER / ADMIN (+ AGENT se policy) |
| Mudar modo OFF/HUMAN_APPROVE/AUTO_SEND | OWNER / ADMIN |
| Gerar lote D0 a partir de import | OWNER / ADMIN |
| Aprovar / rejeitar SUGGESTED | OWNER / ADMIN / AGENT designado |
| AUTO_SEND enable | OWNER / ADMIN + checklist opt-in |

---

## 14. O que deliberadamente não entra na V1.3

- Outbound Campaign Engine completo (DRAFT→RUNNING multi-lote) — lote amarra em `importBatchId` basta  
- Blast / multi-número / A/B  
- NBA `FIRST_TOUCH` como motor (11E.4 extension = V2)  
- Segundo worker além de FollowUp/BullMQ  
- Alterar elegibilidade Recovery para cold `NEW`  
- Disparo no commit do Import V1.2  

---

## 15. Roadmap de implementação (quando houver aprovação)

Complexidade relativa **S / M / L** — sem calendário.

### Fatia A — Fundação (M)

1. Settings First Touch: `mode = OFF | HUMAN_APPROVE | AUTO_SEND` (+ defaults por vertical).  
2. Resolve/create Conversation para lead elegível.  
3. FollowUp `type=OUTBOUND_FIRST_TOUCH` + metadata source.  
4. Side-effect `NEW→CONTACTED` no SENT de `outbound_first_touch`.  
5. Audits + métricas mínimas.

### Fatia B — Geração + modos (L)

1. Templates por vertical + variáveis metadata/import.  
2. Grounding KB opcional via resolver existente.  
3. HUMAN_APPROVE (SUGGESTED → approve → SCHEDULED).  
4. AUTO_SEND (só policy e-commerce / opt-in).  
5. Idempotência e elegibilidade (batch/leads).

### Fatia C — Lote + UI (M–L)

1. “Gerar first-touch” a partir de `importBatchId` / seleção.  
2. UI `/outbound/first-touch`: fila approve, progresso, erros.  
3. Dashboard funil: importados → enviados → responderam → qualificados → HOT → convertidos.  
4. Integração visual com Protection remaining caps.

### Fatia D — Hand-off & hardening (S–M)

1. Validar ponte Recovery (cadence profiles CONSERVATIVE/STANDARD/LONG_CYCLE via settings).  
2. Seed opcional `salesMemory` DISCOVERY.  
3. Testes unit + e2e (OFF / approve / auto / suppress / cap / CONTACTED).  
4. Review + executive report.

**Ordem recomendada:** A → B (HUMAN_APPROVE) → D (Recovery) → C (UI) → AUTO_SEND opcional.

**Critério de done V1.3:**  
piloto ≥1 vertical com D0 aprovado/enviado, lead `CONTACTED` com `lastOutboundAt`, Recovery R1 elegível sem reply, reply inbound aciona 11C/11E, Protection bloqueando over-cap — **zero** blast.

---

## 16. Contratos conceituais (não implementar agora)

### 16.1 Settings (futuro)

```text
CompanyFirstTouchSettings
  mode: OFF | HUMAN_APPROVE | AUTO_SEND
  verticalPlaybook: financeira | imobiliaria | solar | ecommerce | generic
  maxBatchSize: number          // ex. ≤100 D0 por geração
  requireImportBatch: boolean   // piloto: true
  enableKbGrounding: boolean
  enableMemorySeed: boolean
```

### 16.2 APIs futuras (somente desenho)

```text
GET/PATCH /api/outbound/first-touch/settings
GET       /api/outbound/first-touch/dashboard
POST      /api/outbound/first-touch/batches          // from importBatchId
GET       /api/outbound/first-touch/batches/:id
POST      /api/outbound/first-touch/batches/:id/generate
POST      /api/outbound/first-touch/follow-ups/:id/approve  // ou reusar FollowUp approve
POST      /api/outbound/first-touch/batches/:id/cancel
```

Reusar `POST /api/follow-ups/:id/approve` quando possível — evitar fork.

---

## 17. Matriz de reuso (resumo)

| Sistema | Reusa? | Como |
|---------|--------|------|
| Lead Import V1.2 | Sim | Fonte de leads + metadata |
| Protection V1.1 | Sim | Caps, cooldown, opt-out, suppress |
| Conversation / WhatsApp send | Sim | Thread + Evolution |
| FollowUp scheduler | Sim | SUGGESTED/SCHEDULED/execute |
| KB 11A | Sim | Grounding copy D0 |
| Intents 11B | Indireto | Pós-reply; kind KB no D0 |
| AUTO 11C | Sim | Só após inbound |
| Recovery 11D | Sim | D1+ após CONTACTED + lastOutboundAt |
| Sales Brain 11E | Sim | Pós-reply; seed DISCOVERY opcional |

---

## 18. Encerramento

Este documento **projeta** o First Touch Engine V1.3.  
**Não implementa** código, migrations, schema nem APIs.

Próximo passo (só com aprovação explícita): implementar pela ordem do §15, começando por **settings OFF + Conversation + FollowUp D0 + side-effect CONTACTED + HUMAN_APPROVE**, reutilizando Protection V1.1 e Import V1.2.

**PARAR aqui.** Não iniciar implementação da V1.3 neste passo.
