# Design — Vertical Financeiras / Consórcios / Crédito / Financiamento de Veículos

**Tipo:** auditoria + design (sem código · sem migrations · sem implementação)  
**Data:** 2026-08-09  
**Branch:** `cursor/financial-services-vertical-design-dd93`  
**Base do produto:** Autopilot CRM + WhatsApp (Evolution) + AI Sales Agent 11A–11E  
**Documentos relacionados:** `docs/outbound-sales-engine-audit.md`, `docs/first-pilot-playbook.md`, `docs/ai-sales-agent-11e-design.md`

---

## 0. Veredito em uma frase

Uma financeira pequena hoje gasta a maior parte do tempo humano em **triagem WhatsApp, cobrança de resposta e coleta informal de documentos** — exatamente o que o Autopilot já cobre bem com **ASSIST/AUTO + Recovery 11D + Sales Brain 11E**. O que **não** cobre é o núcleo regulado: **cofre de documentos, análise de crédito, papéis de analista e etapas pós-qualificação**. O MVP de piloto deve **substituir operadores de atendimento/prospecção**, não o analista de crédito.

---

## 1. Como uma financeira trabalha hoje

### 1.1 Perfil típico (financeira pequena / correspondente / consórcio)

| Dimensão | Realidade operacional comum |
|----------|----------------------------|
| Equipe | 3–12 pessoas: atendentes WhatsApp, closers comerciais, 1–2 analistas de crédito, 1 gestor |
| Ticket | Financiamento de veículos, consignado, crédito pessoal, carta de consórcio — ticket médio alto, ciclo 1–15 dias |
| Canal dominante | WhatsApp (quase 100% do funil inicial); telefone para fechamento / pendências |
| Sistema | Planilha + WhatsApp Web + e-mail do banco/parceiro; CRM raro ou subutilizado |
| Diferencial | Relacionamento + velocidade de resposta + capacidade de “puxar documento” |

### 1.2 Origem dos leads

```text
Inbound quente          Inbound morno              Outbound / reativação
─────────────────       ─────────────────          ─────────────────────
• Anúncio Meta/Google   • Indicação                • Base antiga (planilha)
• Site / landing        • Parceiro (loja,          • Lista de opt-in próprio
• WhatsApp no anúncio     corretor, oficina)       • Pós-contemplação / renovação
• Walk-in encaminhado   • Marketplace / lead gen   • ⚠ Lista fria comprada (alto risco)
```

**Peso típico numa financeira pequena:** 40–60% inbound pago/orgânico, 20–30% indicação/parceiro, 10–30% reativação de base. Cold list comprada existe no mercado, mas é **no-go** para piloto Autopilot (risco Evolution + compliance — ver outbound audit §2.3).

### 1.3 Funil comercial real (não o CRM genérico)

```text
1. CAPTURA          lead chega (WA / planilha / parceiro)
2. PRIMEIRO TOQUE   “vi seu interesse / posso te ajudar com crédito/consórcio?”
3. TRIAGEM          produto? valor? cidade? urgência? CPF/renda aproximada?
4. QUALIFICAÇÃO     encaixa no perfil do produto/parceiro?
5. COLETA DOCS      RG/CNH, CPF, comprovante renda, comprovante endereço,
                    docs do bem (CRLV, nota, fotos) — se veículo
6. ANÁLISE CRÉDITO  humano + sistema do banco/parceiro (fora do WA)
7. CONTRAPROPOSTA   taxa, prazo, entrada, condição alternativa
8. FECHAMENTO       assinatura / formalização / envio ao banco
9. PÓS-VENDA        pendência documental, liberação, indicação
```

Mapeamento bruto para `LeadStatus` atual do Autopilot:

| Etapa real | Status Autopilot mais próximo | Ajuste |
|------------|-------------------------------|--------|
| Captura | `NEW` | OK |
| Primeiro toque | `CONTACTED` | OK (se outbound/manual atualizar) |
| Triagem / resposta | `RESPONDED` | OK |
| Qualificação comercial | `QUALIFIED` | OK — mas mistura “qualificado comercial” com “apto a análise” |
| Coleta docs / análise / proposta | *(sem estágio)* | Gap — hoje fica preso em QUALIFIED ou vira nota |
| Fechamento / formalização | `CONVERTED` | Parcial — CONVERTED = objetivo comercial, não necessariamente contrato pago |
| Perdido / recusa / sem encaixe | `LOST` | OK |

### 1.4 Documentos exigidos (por linha de produto)

| Documento | Financiamento veículo | Crédito pessoal / consignado | Consórcio |
|-----------|----------------------|------------------------------|-----------|
| RG / CNH | Obrigatório | Obrigatório | Obrigatório |
| CPF | Obrigatório | Obrigatório | Obrigatório |
| Comprovante de renda | Quase sempre | Quase sempre | Frequente |
| Comprovante de endereço | Frequente | Frequente | Frequente |
| Extrato / holerite / IR | Sob demanda | Sob demanda | Sob demanda |
| CRLV / docs do bem | Obrigatório | — | Se bem contemplado |
| Nota fiscal / proposta loja | Frequente | — | — |
| Autorização consulta SCR/Serasa | Processo parceiro | Processo parceiro | Processo parceiro |
| Selfie / prova de vida | Crescente (parceiro) | Crescente | Crescente |

**Hoje na operação:** o atendente pede foto no WhatsApp, salva no celular/Drive, renomeia mal, perde versão, reenvia ao analista por outro canal. Esse atrito é o maior “trabalho burro” pós-triagem.

### 1.5 Papel dos operadores

| Papel | O que faz o dia todo | Intensidade |
|-------|----------------------|-------------|
| **Atendente WA / SDR** | Responde inbound, faz 1º toque, pergunta orçamento/produto, agenda retorno, cobra “me manda o doc” | Alta repetição |
| **Closer comercial** | Negocia entrada/parcela, compara produtos, trata objeção de taxa/confiança, empurra para análise | Média–alta habilidade |
| **Analista de crédito** | Valida docs, consulta parceiro/banco, decide encaixe, pede pendência | Alta especialização + compliance |
| **Gestor** | Distribui leads, olha conversão, treina script, resolve caso escalado | Baixo volume, alto julgamento |

### 1.6 Onde a IA pode substituir trabalho humano (hipótese)

| Trabalho | Substituível pela IA Autopilot? | Como |
|----------|--------------------------------|------|
| Resposta imediata a FAQ (horário, produtos, “como funciona”) | **Sim (alto)** | KB + ASSIST/AUTO |
| Triagem (produto, cidade, urgência, faixa de valor) | **Sim (alto)** | Sales Memory + NBA + Purchase Intent |
| Cobrar resposta / retomar lead silencioso | **Sim (alto)** | Recovery 11D |
| Tratar objeção de preço/tempo/confiança (script) | **Parcial** | Objection Engine — AUTO só PRICE/TIME/TRUST em WARM/HOT |
| Pedir e checklistar documentos | **Parcial no futuro** | Hoje só texto/nota; falta mídia + checklist |
| Priorizar fila do closer (“quem está quente”) | **Sim (médio–alto)** | Score + Purchase Intent + NBA |
| Negociar taxa / prometer aprovação | **Não** | Compliance — escalate humano |
| Analisar crédito / consultar bureau | **Não** | Fora do produto; handoff |
| Formalizar contrato | **Não** | Fora do produto |

### 1.7 Onde precisa de escalonamento humano (obrigatório)

| Situação | Por quê |
|----------|---------|
| Cliente pede “aprovação garantida” / pressão ilegal | Compliance / AUTHORITY |
| Objeção de autoridade (“preciso falar com meu marido/sócio”) | Já mapeado → escalate |
| Reclamação / ameaça / dados sensíveis mal pedidos | Intent COMPLAINT / HUMAN |
| Lead HOT parado após várias tentativas de close | Objection / NBA ESCALATE_HUMAN |
| Qualquer decisão de crédito, taxa final, exceção de política | Analista |
| Documento ilegível / inconsistência cadastral | Analista / closer |
| Cliente pede voz / ligação | Humano (canal) |

---

## 2. Como ela trabalharia usando o Autopilot

### 2.1 Modelo operacional alvo (piloto)

```text
Lead opt-in / inbound
        │
        ▼
┌───────────────────┐
│  Autopilot WA     │  1º toque humano ou semi (ASSIST)
│  + AI ASSIST/AUTO │  triagem, FAQ, coleta de slots
└─────────┬─────────┘
          │ silêncio → Recovery 11D (cadência conservadora)
          │ reply → Sales Brain 11E (score / objeção / NBA / intent)
          ▼
┌───────────────────┐
│  Fila do closer   │  HOT / Purchase Intent HIGH / QUALIFIED
│  (1–2 humanos)    │  negociação + pedido de docs (WA)
└─────────┬─────────┘
          │ docs ok + encaixe comercial
          ▼
┌───────────────────┐
│  Analista crédito │  FORA do Autopilot (parceiro/banco)
│  (humano)         │  status voltando via nota/status manual
└─────────┬─────────┘
          ▼
     CONVERTED / LOST no CRM
```

### 2.2 Dia a dia por papel no Autopilot

| Papel | Usa no Autopilot | Deixa de fazer |
|-------|------------------|----------------|
| Atendente / SDR | Quase nada no piloto maduro — IA cobre; humano só revisa ASSIST | Responder “qual o valor da parcela?”, “atendem em X?”, follow-up D+1/D+3 |
| Closer | Inbox Conversas + Lead Workspace (NBA, Intent, Memory) + approve FollowUps | Caçar lead frio na planilha; reescrever o mesmo script |
| Analista | Recebe caso já triado (export/nota/assign); **não** opera o chat o dia todo | Pedir 5 vezes o mesmo comprovante (ainda parcial sem vault) |
| Gestor | Dashboard IA, Recovery, Funil, Export | Microgerenciar resposta de cada lead NEW |

### 2.3 Configuração de produto recomendada (piloto)

| Setting | Valor sugerido financeira | Motivo |
|---------|---------------------------|--------|
| AI mode | **ASSIST** na 1ª semana; AUTO só FAQ depois | Risco de copy inadequada em crédito |
| Recovery | ON, `maxAttempts=2–3`, cadence 24/72/168h, janela comercial | Nurture pós-contato; sem cold NEW |
| Stop on reply / human takeover | ON | Obrigatório |
| KB | Taxas *indicativas*, prazos, documentos, “não prometemos aprovação”, cidades/parceiros | Grounding |
| AUTO intents | Só FAQ grounded (PRICE/PRODUCT/PAYMENT/HOURS…) | Nunca CREDIT promise |
| Objeções AUTO | PRICE/TIME/TRUST se WARM/HOT | AUTHORITY/NEED → humano |
| Outbound | Opt-in próprio, volume baixo, 1º toque humano/semi | Ver outbound audit §2.3 |

### 2.4 Copy e compliance (regras de operação, não de código)

1. Nunca afirmar aprovação, score interno ou “crédito liberado”.  
2. Sempre falar em **análise sujeita a política do parceiro/banco**.  
3. Pedir documento só **depois** de encaixe comercial mínimo (produto + faixa + urgência).  
4. CPF/renda: no produto atual o prompt de suggest **proíbe pedir CPF** — no piloto financeiro isso vira **script humano/closer** até redesign de prompt/vertical pack.  
5. Opt-out verbal (“não quero”) → status `LOST` + suppress operacional (planilha) até existir registry.

---

## 3. Quantos operadores poderiam ser substituídos

Estimativa de **capacidade liberada**, não demissão automática. Uma financeira pequena tipicamente tem **2–4 pessoas** que passam o dia no WhatsApp fazendo trabalho repetível.

### 3.1 Cenário de referência

| Papel hoje | Headcount típico | % tempo repetível (FAQ + follow-up + triagem) | Capacidade liberada com Autopilot maduro* |
|------------|------------------|-----------------------------------------------|-------------------------------------------|
| Atendente WA / SDR | 2 | 70–85% | **1,4–1,7 FTE** |
| Closer | 2 | 25–40% (priorização + 1ª resposta) | **0,5–0,8 FTE** |
| Analista crédito | 1–2 | 5–15% (só cobrança de doc) | **0,1–0,3 FTE** (baixo até haver vault) |
| Gestor | 1 | 10–20% (distribuição) | **0,1–0,2 FTE** |

\*Assumptions: ASSIST→AUTO em FAQ, Recovery ativo, Sales Brain priorizando HOT, base inbound/opt-in, volume ~30–80 conversas ativas/semana.

### 3.2 Leitura executiva

| Métrica | Faixa piloto (4–6 semanas) | Faixa madura (pós-playbook + KB boa) |
|---------|----------------------------|--------------------------------------|
| Operadores de atendimento “equivalentes” substituíveis | **0,5–1 FTE** | **1,5–2,5 FTE** |
| Closers elimináveis | **0** (mudam de papel) | **0–0,5 FTE** (time menor ou mais capacidade) |
| Analistas elimináveis | **0** | **0** (papel permanece) |

**Regra prática para venda do piloto:**  
> “Com Autopilot, a financeira opera o mesmo volume de leads com **1 atendente a menos** (ou dobra o volume com o mesmo time). O analista continua. O closer foca só nos quentes.”

Não prometer substituição do analista de crédito no MVP.

---

## 4. Quais módulos atuais já resolvem o problema

| Necessidade da financeira | Módulo Autopilot | Cobertura |
|---------------------------|------------------|-----------|
| Captura e cadastro de lead | Leads API/UI, phone único, `source` | ✅ Pronto (unitário) |
| Conversa WhatsApp 1:1 | Evolution + Conversations | ✅ Pronto (texto) |
| Resposta assistida / automática FAQ | AI 11C ASSIST/AUTO + KB | ✅ Pronto |
| Memória comercial (orçamento, produto, cidade, urgência, pagamento) | 11E.1 Sales Memory | ✅ Pronto (slots genéricos) |
| Priorizar lead quente | 11E.2 Score + 11E.5 Purchase Intent | ✅ Pronto |
| Tratar objeção taxa/tempo/confiança | 11E.3 Objection Engine | ✅ Pronto (parcial AUTO) |
| Próxima melhor ação no chat | 11E.4 NBA | ✅ Pronto (ações genéricas) |
| Retomar lead que sumiu | 11D Recovery + FollowUp scheduler | ✅ Pronto (pós first-touch) |
| Escalonar para humano | Intent escalate + `agentPaused` + assign | ✅ Pronto (sem fila “crédito”) |
| Visão do operador | Lead Workspace, Funil, Dashboard IA, Recovery UI | ✅ Pronto |
| Export para ops/parceiro | Exports CSV | ✅ Pronto |
| Multi-usuário / papéis | OWNER / ADMIN / AGENT | ✅ Parcial (sem papel ANALISTA) |

**Conclusão:** o miolo de **atendimento + nurture + priorização** já existe. O miolo de **crédito + documentos + formalização** não.

---

## 5. Quais adaptações específicas seriam necessárias

Organizadas por prioridade de produto (design only).

### 5.1 P0 — necessárias para piloto real seguro (processo + config, mínimo de produto novo)

| Adaptação | Tipo | Notas |
|-----------|------|-------|
| Playbook + KB pack “Financeira” | Ops / conteúdo | FAQ: taxas indicativas, prazos, docs, disclaimer de não-aprovação, cidades/parceiros |
| Script de 1º toque + ASSIST-only week 1 | Ops | Alinha com outbound audit §2.3 |
| Taxonomia de `source` (`meta_ads`, `indicacao`, `parceiro_loja`, `base_optin`) | Processo (string livre já permite) | Filtro de listagem ainda não existe — ops usa export/search |
| Cadência Recovery conservadora + horários comerciais | Config | Evitar spam e risco Evolution |
| Treino closer: ler NBA / Intent / Memory antes de ligar | Ops | Substitui parte do briefing |
| Suppress/opt-out em planilha paralela | Ops paliativo | Até existir registry |
| Regra humana para pedido de CPF/docs | Ops | Prompt atual desencoraja CPF — closer assume |

### 5.2 P1 — adaptações de produto (pós-piloto ou bloqueio se volume crescer)

| Adaptação | Por quê |
|-----------|---------|
| Vertical pack / industry na Company | Liga prompts, KB seed, disclaimers |
| Slots de memória: `productLine` (FINANCIAMENTO_VEICULO / CONSORCIO / CREDITO_PESSOAL / CONSIGNADO), `entrada`, `parcelaDesejada`, `rendaFaixa`, `bemInteresse` | Triagem financeira ≠ e-commerce |
| Intents / NBA: `ASK_DOCUMENTS`, `CREDIT_HANDOFF`, checklist status | Fecha o buraco entre QUALIFIED e análise |
| Estágios de workflow (metadata tipada ou substatus): `DOCS_PENDING`, `IN_ANALYSIS`, `APPROVED`, `FORMALIZING` | Funil real sem estourar enum MVP congelado — preferir metadata tipada no design |
| Receber/enviar mídia WhatsApp + cofre de anexos por lead | Elimina o caos de foto no celular do atendente |
| Fila / papel `CREDIT_ANALYST` ou fila “precisa humano — crédito” | Handoff estruturado |
| Opt-out registry + suppress no send/recovery | Compliance |
| Ajuste de prompt: permitir pedir **dados cadastrais mínimos** com guardrail (nunca senha/cartão; CPF só após opt-in e contexto) | Desbloqueia coleta assistida |
| Ticket default / Purchase Intent calibrado para ticket alto (crédito) | Hoje default retail (~R$500) distorce bandas |

### 5.3 P2 — diferenciação por linha de produto

| Linha | Particularidade de design |
|-------|---------------------------|
| **Financiamento de veículos** | Slot bem (ano/modelo/valor); docs CRLV; parceria loja; objeção entrada vs parcela |
| **Crédito pessoal / consignado** | Renda e vínculo empregatício; convênio; menos “produto físico” |
| **Consórcio** | Educar contemplação vs contemplado; objeção tempo/liquidez; não vender como “empréstimo imediato” |

Cada linha = **pack de KB + scripts de Recovery + mapa de objeção**, não necessariamente módulos separados.

### 5.4 O que deliberadamente NÃO adaptar no MVP

- Motor de análise de crédito / bureau  
- Assinatura eletrônica / formalização bancária  
- Cadastro de frota / estoque de veículos (já fora do domínio MVP)  
- Blast outbound em lista fria  
- Substituição do analista  

---

## 6. MVP para piloto real em uma financeira

### 6.1 Perfil do cliente piloto

| Critério | Ideal |
|----------|-------|
| Tipo | Financeira pequena / correspondente / consórcio local |
| Time | 1 champion + 1–2 AGENT closers (+ analista fora do chat) |
| Volume | 40–120 leads/mês opt-in ou inbound (não cold comprada) |
| Canal | 1 linha WhatsApp Evolution dedicada |
| Maturidade | Já atende por WA hoje; dor = demora e lead frio |
| Apetite compliance | Aceita disclaimer e ASSIST-first |

### 6.2 Escopo MVP (4–6 semanas) — só o que já existe + ops

**Dentro:**

1. Provisionar company + WA + usuários (playbook padrão).  
2. Popular KB financeira (10–20 entradas: produtos, prazos, docs, disclaimer, horários).  
3. AI em **ASSIST**; opcional AUTO só em FAQ grounded na semana 3+.  
4. Recovery ON com cadência conservadora.  
5. Inbound + reativação opt-in com **1º toque humano/semi** (sem Campaign Engine).  
6. Closers trabalham Lead Workspace com Score / Objection / NBA / Purchase Intent.  
7. Qualificado comercial → humano pede docs no WA → analista fora → status CONVERTED/LOST.  
8. Métricas: tempo 1ª resposta, reply rate, recovery sent, % HOT, conversões, escalations.

**Fora do MVP:**

- Import CSV produto (ops pode API/manual se ≤100 leads)  
- Cofre de documentos  
- Substatus de crédito  
- Papel ANALISTA  
- AUTO no first-touch / promessas de aprovação  
- Campanhas blast  

### 6.3 Fluxo MVP fim a fim

```text
Semana 0  Setup + KB + treino closer (2h) + scripts
Semana 1  ASSIST only · inbound real · humano aprova sugestões
Semana 2  Recovery ligado · medir silence→reply
Semana 3  AUTO FAQ (se qualidade OK) · closer só HOT/HIGH intent
Semana 4+ Retrospectiva: FTE liberado · conversão · incidentes Evolution/compliance
```

### 6.4 Critérios de sucesso do piloto

| Indicador | Alvo qualitativo |
|-----------|------------------|
| Tempo até 1ª resposta útil | Minutos (IA/ASSIST) vs horas (baseline humano) |
| Leads sem resposta >24h com Recovery | Queda clara vs baseline |
| % do tempo do atendente em FAQ repetido | Queda ≥50% |
| Escalations indevidos / copy irregular | ≈0 incidentes graves |
| Conversões atribuíveis | ≥ baseline; ideal + uplift via recovery de “mortos” |
| Satisfação do closer | “Só falo com quem está quente” |

### 6.5 Go / no-go

| Go | No-go |
|----|-------|
| Base opt-in ou inbound pago próprio | Lista fria comprada |
| Champion opera o CRM diariamente | Time só quer “robô que aprova crédito” |
| Aceita ASSIST-first | Exige AUTO full + promessa de aprovação |
| 1 número WA estável | Compartilhar número com blast marketing |
| Analista permanece no processo | Esperar Autopilot substituir underwriting |

---

## 7. Respostas diretas (checklist do pedido)

### 1. Como uma financeira trabalha hoje?

Por WhatsApp e planilha: captura inbound/indicação, triagem manual, follow-up inconsistente, coleta caótica de documentos, análise de crédito humana/parceiro, fechamento fora do CRM.

### 2. Como trabalharia usando o Autopilot?

IA faz FAQ, triagem e recovery; Sales Brain prioriza quentes; closer negocia e pede docs; analista continua fora; status volta ao funil Autopilot. ASSIST-first, Recovery conservador, sem blast.

### 3. Quantos operadores poderiam ser substituídos?

No maduro: **~1,5–2,5 FTE de atendimento/SDR**; closers **reposicionados** (não eliminados); analistas **0**. No piloto curto: **~0,5–1 FTE** liberado.

### 4. Quais módulos atuais já resolvem?

Leads + WhatsApp texto + FollowUp + Recovery 11D + AI ASSIST/AUTO + KB + Sales Brain 11E (Memory, Score, Objection, NBA, Purchase Intent) + escalate/assign + dashboards/export.

### 5. Quais adaptações específicas?

P0 ops: KB/playbook financeira, ASSIST-first, cadência, taxonomia de source, closer lendo NBA/Intent.  
P1 produto: vertical pack, slots financeiros, mídia/docs, handoff crédito, opt-out, prompt/compliance, calibração de intent.  
P2: packs por linha (veículo / crédito / consórcio).

### 6. MVP para piloto real?

Uma financeira opt-in/inbound, 1 WA, 1–2 closers, KB + ASSIST + Recovery + 11E, docs e crédito ainda humanos, 4–6 semanas, sem Campaign Engine e sem vault — medir FTE liberado e conversão antes de construir P1.

---

## 8. Diferença inbound vs outbound nesta vertical

| | Inbound financeira | Outbound financeira (piloto) |
|--|--------------------|------------------------------|
| Origem | Anúncio, site, indicação | Base própria opt-in / reativação |
| 1º toque | Cliente fala primeiro → pipeline 11E natural | Humano/semi → depois Recovery |
| Risco Evolution | Menor | Maior — volume e copy críticos |
| Valor do Autopilot | Tempo de resposta + qualificação | Não deixar base morrer + priorizar quem responde |
| Recomendação | **Começar aqui** | Só com lista própria e caps (outbound audit) |

---

## 9. Fases recomendadas da vertical (após MVP)

| Fase | Foco | Entrega de valor |
|------|------|------------------|
| **V1 — Atendimento financeiro** | Este MVP: KB + ASSIST/AUTO FAQ + Recovery + 11E + closer na fila quente | Substitui SDR repetitivo |
| **V2 — Coleta e handoff** | Mídia WA, checklist docs, substatus/metadata, fila crédito, opt-out | Reduz caos documental; acelera analista |
| **V3 — Vertical packs** | Consórcio vs financiamento vs consignado; prompts/NBA específicos; calibração de intent; possível import controlado | Escala multi-produto sem blast agressivo |

---

## 10. Riscos específicos da vertical

| Risco | Severidade | Mitigação no design |
|-------|------------|---------------------|
| Copy que implica aprovação de crédito | Crítica | ASSIST-first + KB disclaimer + escalate AUTHORITY |
| Pedido precoce de CPF/docs (LGPD / confiança) | Alta | Só pós-encaixe; closer no MVP; redesign de prompt depois |
| Bloqueio Evolution por volume/reativação | Alta | Caps, opt-in, cadence 11D, 1 número |
| Esperar underwriting no Autopilot | Alta (expectativa) | Escopo explícito: atendimento, não análise |
| Prompt atual vs necessidade de dado cadastral | Média | Processo humano até P1 |
| Ticket alto distorcendo Purchase Intent | Média | Calibrar default / pesos na V2 |
| Analista fora do sistema → status desatualizado | Média | Ritual diário CONVERTED/LOST + notas |

---

## 11. Próximos passos (não implementação)

1. Escolher 1 financeira piloto que passe no go/no-go §6.5.  
2. Redigir KB pack + scripts (conteúdo) a partir deste design.  
3. Rodar MVP V1 só com produto atual.  
4. Só então priorizar P1 (docs/mídia/handoff) com base em atrito real medido.

**PARAR aqui.** Sem código, sem migrations, sem implementação.
