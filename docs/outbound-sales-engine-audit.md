# Auditoria — Outbound Sales Engine (prospecção ativa)

**Tipo:** auditoria + design (sem código · sem migrations · sem implementação)  
**Data:** 2026-08-08  
**Branch:** `cursor/outbound-sales-engine-audit-dd93`  
**Base do produto:** Autopilot CRM + WhatsApp (Evolution) + AI Sales Agent 11A–11E  
**Posicionamento atual do produto:** **inbound-first** com nurture/recovery pós-contato

---

## 0. Veredito em uma frase

O Autopilot já tem **canal de envio 1:1**, **FollowUp Scheduler**, **Recovery 11D** e **Sales Brain 11E** — peças fortes para *nurture* depois do primeiro toque. **Não** tem motor de campanha, importação em massa, templates WhatsApp, nem cold start de listas NEW. O menor caminho para piloto outbound é **reusar Recovery + FollowUp + Sales Brain** com um **primeiro toque humano/semi-manual** controlado, não construir um blast engine.

---

## 1. Mapa do que existe vs. o que falta

### 1.1 Importação de leads

| Capacidade | Status | Evidência |
|------------|--------|-----------|
| Criar lead unitário (API/UI) | ✅ Pronto | `POST /api/leads`, `CreateLeadDialog` |
| Campos `source`, `phone`, `metadata`, `externalId` | ✅ Parcial | `Lead.source` string livre (default `WHATSAPP`); sem taxonomia |
| Unicidade de telefone por empresa | ✅ Pronto | Partial unique `uq_leads_company_phone_active` |
| Bulk assign de owner | ✅ Pronto | `POST /api/leads/bulk-assign` |
| Export CSV | ✅ Pronto | `GET /api/exports/leads` |
| Import CSV / Excel / bulk create | ❌ Falta | Explicitamente fora de escopo em playbooks / CRM ops design |
| Tags em Lead | ❌ Falta | Tags existem só em Knowledge Base |
| LeadSource tipado / filtros por fonte | ❌ Falta | `source` não é enum nem filtro de listagem |

**Implicação outbound:** listas de prospecção entram hoje **uma a uma** (ou via API custom externa). Sem import, piloto de volume fica operacionalmente caro.

---

### 1.2 Campanhas

| Capacidade | Status | Evidência |
|------------|--------|-----------|
| Modelo `Campaign` / módulo / UI | ❌ Ausente | Zero matches em schema/rotas/web |
| Audiência / segmento / A/B | ❌ Ausente | — |
| Broadcast / blast | ❌ Ausente | — |
| “Campanha” no produto | ⚠️ Só Recovery | `CompanyRecoverySettings.cadenceHours` = cadência de *recovery*, não marketing campaign |

**Implicação:** não há produto de “campanha de prospecção”. O análogo mais próximo é **política de Recovery por empresa**.

---

### 1.3 Disparo inicial (primeiro toque)

| Capacidade | Status | Evidência |
|------------|--------|-----------|
| Envio WhatsApp texto 1:1 | ✅ Pronto | `POST /api/whatsapp/send` → `WhatsappSendService` → `EvolutionClient.sendText` |
| Pré-requisitos | ✅ Pronto | Lead + Conversation OPEN/IDLE + Instance `CONNECTED` |
| Composer na conversa (UI) | ✅ Pronto | Modo WhatsApp no detalhe da conversa |
| FollowUp manual → SCHEDULED → execute | ✅ Pronto | `FollowUpService` + DueScanner + BullMQ |
| Mensagem só no CRM (sem WA) | ✅ Pronto | `POST /conversations/:id/messages` |
| Templates HSM / Evolution template | ❌ Falta | Só `sendText`; sem `sendTemplate` |
| Bulk first-touch / fila de abertura | ❌ Falta | Um send por request |
| Auto `NEW → CONTACTED` no 1º outbound | ⚠️ Design gap | Descrito em `ai-agent-platform-design.md`; código do send só atualiza `lastOutboundAt` / `lastContactAt` |
| Opt-in / opt-out registry | ❌ Falta | 11D declara opt-out fora de escopo |

**Fluxo mínimo atual para 1º toque:**

```text
POST /leads → POST /conversations → POST /whatsapp/send
(ou UI: criar lead → abrir conversa → composer WhatsApp)
```

---

### 1.4 Sequências automáticas

| Capacidade | Status | Evidência |
|------------|--------|-----------|
| FollowUp lifecycle | ✅ Pronto | SUGGESTED → APPROVED → SCHEDULED → EXECUTING → EXECUTED |
| Scanner de due + worker | ✅ Pronto | `FollowUpDueScanner` + `FollowUpSchedulerProcessor` (`ASYNC_FOLLOWUP_ENABLED`) |
| Recovery automático R1/R2/R3 | ✅ Pronto | 11D — `AiRecoveryScanner` + `AiRecoveryService` |
| Cadência editável + janela horária | ✅ Pronto | `CompanyRecoverySettings` |
| Stop on reply / takeover / terminal | ✅ Pronto | Hooks inbound + `agentPaused` + CONVERTED/LOST |
| Sequência de *cold* para NEW | ❌ Falta | Recovery **exige** `CONTACTED\|RESPONDED` + `lastOutboundAt` |
| Multi-step comercial (D0 oferta → D1 prova → D3 CTA) tipado | ❌ Falta | Só cadência de recovery genérica |

**Elegibilidade Recovery (crítica para outbound):**

```text
status ∈ {CONTACTED, RESPONDED}
AND lastOutboundAt ≠ null
AND conversa OPEN/IDLE
AND cliente NÃO foi o último a falar
AND WhatsApp CONNECTED
AND AI mode ≠ OFF
```

Ou seja: Recovery **não inicia** prospecção; **continua** após um primeiro outbound.

---

### 1.5 Limites WhatsApp / Evolution

| Camada | Existe? | Detalhe |
|--------|---------|---------|
| Timeout / retry / 429 wait | ✅ | `evolution.constants.ts` — wait máx. ~5s em rate limit |
| Circuit breaker | ✅ | `evolution.circuit-breaker.ts` |
| Connect cooldown | ✅ | Evita spam de QR/connect |
| `sendText` sem auto-retry | ✅ | Reduz double-send (CH2) |
| Async outbound queue | ✅ Opcional | `ASYNC_OUTBOUND_ENABLED` (default false), attempts=1 |
| AUTO AI rate | ✅ | 20/empresa/min · 8/conversa · cooldown lead 60s · anti-loop 2 |
| Recovery rate | ✅ | 10/empresa/min |
| Cap diário AUTO por lead | ✅ | `maxAutoRepliesPerLeadDay` (default 3) |
| Throttle global de send humano | ❌ | `/whatsapp/send` autenticado sem rate de blast |
| Templates oficiais / janela 24h Meta | ❌ | Evolution não-oficial; risco operacional alto em cold |
| 1 instância ativa / empresa | ✅ | Partial unique em `WhatsAppInstance` |

---

### 1.6 Reutilização do Recovery Engine (11D)

| Peça | Reuso para outbound |
|------|---------------------|
| Policy `CompanyRecoverySettings` | ✅ Cadência / cooldown / maxAttempts / allowedHours |
| FollowUp `AI_RECOVERY` + scheduler | ✅ Canal de execução já batalha-testado |
| `AiRecoveryMessageService` | ✅ Copy grounded em KB + Sales Memory |
| Stop conditions | ✅ Anti-spam comportamental (reply/takeover/lost) |
| Dashboard `/ai/recovery` + metrics | ✅ Operação e prova de valor |
| Cold start NEW / listas | ❌ Precisa extensão de elegibilidade + 1º toque |
| Audiência / campanha | ❌ Não existe; seria V2+ |

**Conclusão:** Recovery é o **motor de sequência pós-contato**. Para outbound, o desenho correto é:

```text
[V1] 1º toque controlado (humano ou job estreito)
  → status CONTACTED + lastOutboundAt
  → Recovery 11D assume R1/R2/R3
  → inbound acorda Sales Brain 11E
```

---

### 1.7 Reutilização do Sales Brain (11E)

| Módulo | Assume inbound? | Serve outbound? |
|--------|-----------------|-----------------|
| **11E.1 Sales Memory** | Extrator roda no inbound | ✅ Persistência/leitura já alimenta Recovery; cold = memória vazia |
| **11E.2 Lead Scoring** | Conta inbounds / recovery reply | ✅ Após tráfego; NEW frio fica COLD (útil para priorizar) |
| **11E.3 Objection** | Detecta fala do cliente | ✅ Só pós-resposta (correto) |
| **11E.4 NBA** | Silêncio → `SCHEDULE_RECOVERY` | ✅ Ótimo para nurture; falta NBA de “primeiro toque” |
| **11E.5 Purchase Intent** | Multi-inbound / fast reply | ✅ Prioriza quem esquentar após outbound |
| **Assist/AUTO pipeline** | Hook só pós-inbound | ❌ Não inicia conversa |

**Conclusão:** 11E brilha **depois** da resposta. Não substitui campanha; **qualifica e conduz** o lead que respondeu ao outbound.

---

### 1.8 Riscos de bloqueio Evolution / WhatsApp

| Risco | Severidade em outbound cold | Mitigação hoje | Gap |
|-------|----------------------------|----------------|-----|
| Ban / restrição por spam de lista fria | **Alta** | Rate só em AUTO/Recovery | Send humano sem throttle de volume |
| Sessão Evolution cai (QR) | Alta em escala | Send exige CONNECTED; runbook | 1 número = SPOF |
| 429 provider | Média | Wait + circuit breaker | Sem backoff de fila de campanha |
| Double send | Baixa (já mitigado) | Claim + attempts=1 | — |
| Echo inbound | Baixa | `parseEchoCandidate` / heal | — |
| Mensagens genéricas repetidas | Alta | Recovery regen + KB | Cold copy sem variação suficiente |
| Sem opt-out formal | Alta (compliance) | Stop on reply / LOST manual | Precisa lista/suppress antes de piloto regulado |
| Canal não-oficial (Evolution) | Estrutural | Aceito no arquitetura atual | Financeiras: preferir opt-in forte + volume baixo |

**Regra de ouro do piloto:** tratar Evolution como **canal conversacional**, não como ESP de e-mail marketing.

---

### 1.9 Diferenças inbound vs outbound (arquitetura)

```text
INBOUND (hoje — núcleo maduro)
  Webhook Evolution
    → Lead upsert (CONTACTED) + Conversation + Message INBOUND
    → stop Recovery on reply
    → AiAssistPipeline (Memory → Score → Objection → NBA → Purchase Intent → ASSIST/AUTO)

OUTBOUND (hoje — 1:1 + nurture)
  API autenticada / FollowUp due / AUTO reply / Recovery send
    → WhatsappSendService (PENDING→SENT)
    → lastOutboundAt
    → (não cria campanha; não promove NEW→CONTACTED automaticamente)
```

| Dimensão | Inbound | Outbound atual |
|----------|---------|----------------|
| Origem do lead | Auto no webhook | Manual/API |
| Trigger de IA | Mensagem do cliente | Só se já houve inbound (Assist/AUTO) ou Recovery agendado |
| Volume seguro | Resposta 1:1 | Baixo; sem blast |
| Valor do Sales Brain | Alto imediato | Alto **após** reply |
| Compliance | Cliente iniciou | Exige opt-in / relação prévia |

---

## 2. Respostas objetivas

### 2.1 O que já está pronto

1. CRM de leads + conversas + timeline + follow-ups.  
2. WhatsApp 1:1 (send + delivery + session).  
3. FollowUp Scheduler (base de qualquer sequência).  
4. **Recovery 11D** — cadência, stops, métricas, UI.  
5. **Sales Brain 11E** — memória, score, objeção, NBA, purchase intent (pós-reply).  
6. KB + Assist/AUTO supervisionado (quando o lead fala).  
7. Guardrails de taxa para IA/recovery; audit + Prometheus.  
8. Export CSV e bulk assign (ops parcial).

### 2.2 O que falta (para “Outbound Sales Engine”)

| Prioridade | Gap |
|------------|-----|
| P0 piloto | Import CSV (ou ingestão controlada) + suppress/opt-out |
| P0 piloto | Job/fluxo de **1º toque** com throttle forte + promoção NEW→CONTACTED |
| P0 piloto | Templates / copy de abertura por vertical (mesmo que texto, versionado) |
| P1 | Extender elegibilidade Recovery para “pós first-touch outbound” (já quase; falta o first-touch) |
| P1 | Cap diário global de outbound por empresa/número |
| P2 | Entidade Campaign / audiência / sequência tipada |
| P2 | Templates oficiais / multi-número / warm-up |
| P3 | A/B, scoring de lista, integração CRM externo de leads |

### 2.3 Menor caminho — piloto em **financeiras**

**Contexto:** alto risco regulatório/reputacional; opt-in e tom consultivo obrigatórios; ticket médio tipicamente maior.

**Escopo mínimo (não-blast):**

1. Base **opt-in** pequena (ex.: leads que pediram contato / clientes existentes / lista quente ≤ 50–100).  
2. Import manual/API (ou CSV único operacionalizado pela ops) + tag lógica em `source`/`metadata` (`financeiro_piloto`).  
3. Agente humano ou job **semi-manual** faz 1º toque (mensagem curta, valor, CTA de resposta).  
4. Ao enviar: garantir `CONTACTED` + `lastOutboundAt` (hoje pode exigir ajuste mínimo de política/processo).  
5. Ligar **Recovery 11D** com cadência **conservadora** (ex. 1–2 touches, cooldown alto, allowedHours comerciais).  
6. Quando responder: **11E** (objeção AUTHORITY/TRUST comum em financeiro → escalate humano; Purchase Intent HIGH → fila prioritária).  
7. KB com: taxas, prazos, documentos, “não prometemos aprovação”.  
8. Métricas: reply rate, escalate rate, qualified rate — **não** volume enviado.

**Não fazer no piloto financeiro:** cold list comprada, 3+ touches agressivos, AUTO no primeiro contato, mensagens de “empréstimo aprovado”.

### 2.4 Menor caminho — piloto em **e-commerce**

**Contexto:** ciclo mais curto; objeções PRICE/TIME; Recovery e oferta se encaixam melhor; ainda assim Evolution ≠ Meta Ads.

**Escopo mínimo:**

1. Lista de **carrinho abandonado / browse / base própria** (opt-in ou relação comercial clara) ≤ 200.  
2. 1º toque com oferta/KB PRICE/PRODUCT (texto versionado).  
3. Recovery R1/R2 (D+1 / D+3) com copy de benefício + pergunta (não só “ainda tem interesse?”).  
4. Inbound → 11E: PRICE → `OFFER_ALTERNATIVE`; HOT + pagamento → Purchase Intent VERY_HIGH → priorizar humano/fechamento.  
5. Cap diário baixo (ex. 30–50 msgs/número) + horário comercial.  
6. Sucesso = reply rate + conversão assistida, não open rate de blast.

**Atalho vs financeiras:** pode usar Recovery um pouco mais cedo e copy mais promocional, **desde que** a lista seja própria e o volume caiba no número único.

### 2.5 ROI esperado (ordem de grandeza — hipótese de piloto)

Premissas ilustrativas (ajustar com ticket real do cliente):

| Vertical | Premissa | Faixa plausível de ROI do piloto* |
|----------|----------|-----------------------------------|
| Financeiras | 80 leads opt-in · reply 15–25% · qualificação 30% dos replies · ticket/contribuição alta | **3–8×** custo operacional do piloto se 1–3 deals fecharem; senão ROI ≈ aprendizado |
| E-commerce | 150 leads · reply 20–35% · conversão 5–12% dos replies · ticket médio | **2–5×** se recovery recuperar carrinhos; sensível a margem e custo do número |

\*ROI aqui = (margem atribuível a conversas iniciadas no Autopilot) / (custo de setup + horas de agente + risco operacional). **Não** é projeção financeira auditada.

**Alavancas que o stack atual já captura:**

- Recovery evita “lead esquecido” (custo marginal baixo).  
- 11E reduz tempo humano nos leads quentes (Purchase Intent / NBA).  
- KB + Assist corta tempo de 1ª resposta pós-reply.

**O que **não** prometer:** ROI de “disparo em massa” — o canal não está pronto para isso com segurança.

### 2.6 Fases recomendadas V1 / V2 / V3

#### V1 — Outbound Controlado (piloto)

**Objetivo:** provar reply + qualify sem campanha engine.

- Import operacional (CSV assistido ou API) + `source`/`metadata` de lista.  
- First-touch 1:1 com throttle diário e checklist de opt-in.  
- Auto/processo `NEW→CONTACTED` no 1º send.  
- Recovery 11D ligado (cadência curta).  
- Sales Brain 11E só pós-reply (já existe).  
- Suppress list mínima (LOST + palavra-chave “pare” / stop on reply).  
- Dashboard piloto: enviados · replies · recovery sent · HOT/Purchase Intent · converts.

**Fora de V1:** Campaign entity, blast, multi-número, A/B.

#### V2 — Outbound Assistido (escala cuidadosa)

- Import CSV nativo + validação de telefone + dedupe.  
- “Campanha leve”: audiência estática + sequência tipada reusando FollowUp (D0/D1/D3) **sem** motor paralelo.  
- Cap global por empresa/número + warm-up policy.  
- NBA estendido: ação `FIRST_TOUCH` / `SCHEDULE_OUTREACH`.  
- Opt-out persistido + export de suppress.  
- Templates de abertura versionados na KB (ainda texto).

#### V3 — Outbound Engine (produto)

- Entidade Campaign + segmentos + horários + limites.  
- Multi-instância / fila de números (se Evolution permitir).  
- Templates oficiais se migrar de stack.  
- Experimentos A/B, scoring de lista, ROI por campanha.  
- Integrações (sheets, CRM, ads → lead).

---

## 3. Arquitetura alvo (conceitual — não implementar agora)

```text
                    ┌─────────────────────┐
 Lista opt-in ───► │ Ingestão / Import    │
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │ First Touch (V1)    │  throttle + NEW→CONTACTED
                    └──────────┬──────────┘
                               ▼
              ┌────────────────────────────────┐
              │ Recovery 11D (já existe)       │  R1/R2/R3
              └───────────────┬────────────────┘
                              ▼ reply
              ┌────────────────────────────────┐
              │ Sales Brain 11E (já existe)    │  Memory→Score→Objection→NBA→PI
              └───────────────┬────────────────┘
                              ▼
                         Humano / ASSIST / AUTO (guardrails)
```

**Princípio:** um único caminho de send (`WhatsappSendService` + FollowUp). Nada de motor paralelo de blast.

---

## 4. Checklist de go / no-go para piloto outbound

| Critério | Go se… |
|----------|--------|
| WhatsApp | Instance estável CONNECTED ≥ 7 dias com uso real |
| Lista | Opt-in / relação comprovável; tamanho ≤ limiar da vertical |
| Cap | Limite diário definido e monitorado |
| Recovery | enabled + cadence conservadora + stopOnReply |
| KB | FAQ de objeção/preço/compliance da vertical |
| 11E | Assist mode (AUTO só pós-reply e allowlist) |
| Ops | Playbook de reconnect Evolution + quem pausa campanha |
| Métrica | Reply rate e converts rastreados na 1ª semana |

**No-go:** lista fria comprada, AUTO no D0, >1 número sem warm-up, ausência de stop/opt-out.

---

## 5. Referências internas

| Doc / código | Uso nesta auditoria |
|--------------|---------------------|
| `docs/ai-sales-agent-11d-review.md` | Recovery pronto; escopo e stops |
| `docs/ai-sales-agent-11e-design.md` + reviews 11E.1–11E.5 | Sales Brain pós-inbound |
| `docs/ai-agent-platform-design.md` | NEW→CONTACTED no 1º outbound (gap) |
| `docs/first-pilot-playbook.md` | Piloto inbound; import OOS |
| `docs/business-readiness-audit.md` | Import = P2 |
| `apps/api/docs/whatsapp-design.md` | Riscos canal |
| `apps/api/docs/outbound-worker-review.md` | Fila de send (não marketing) |
| `AiRecoveryService.isEligibleStatus` | Só CONTACTED/RESPONDED |
| `WhatsappSendService` / `EvolutionClient.sendText` | Único caminho de envio |

---

## 6. Encerramento

Esta auditoria **não** autoriza implementação. Próximo passo sugerido (sob aprovação explícita):

1. Decidir vertical do piloto (financeira vs e-commerce).  
2. Aprovar escopo **V1 Outbound Controlado** (first-touch + Recovery + caps).  
3. Só então abrir fase de implementação mínima — sem Campaign Engine completo.

**Sem Fase 12 implícita. Sem código nesta entrega.**
