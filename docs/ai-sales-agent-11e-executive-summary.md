# Fase 11E — Resumo Executivo (Sales Brain)

**Status:** design para aprovação — **não implementar ainda**  
**Data:** 2026-08-08  
**Documento completo:** `docs/ai-sales-agent-11e-design.md`  
**Branch:** `cursor/ai-sales-agent-11e-design-dd93`

---

## 1. Em uma frase

Passar de “IA que **responde** perguntas” para “IA que **conduz uma venda**” — sempre supervisionada, ancorada na KB, integrada ao Recovery 11D.

---

## 2. Por que agora

| Já temos (11A–11D) | Ainda falta |
|--------------------|-------------|
| KB, intents, AUTO seguro, Recovery | Memória comercial entre mensagens |
| Resposta factual | Descoberta, qualificação, objeção, fechamento |
| Dashboard de automação / recovery | Dashboard de **venda** (qualificados, objeções, receita) |

Sem Sales Brain, o agente continua um FAQ inteligente. Com ele, cada conversa tem estágio, score e próximo passo.

---

## 3. O que muda para o negócio

```text
Antes:  preço? → responde preço (se estiver na KB).
Depois: preço? → responde + registra interesse + pergunta budget/urgência + agenda próximo passo.
```

- Menos leads “respondidos e esquecidos”.  
- Recovery deixa de reiniciar a conversa do zero.  
- Humano recebe handoff com contexto (objeção, score, intenção).  
- OWNER vê funil do agente: qualificados → objeções → conversões → receita estimada/recuperada.

---

## 4. Peças do Sales Brain

| Peça | Função |
|------|--------|
| **Sales Stages** | DISCOVERY → … → PURCHASE_INTENT / HANDOFF / CONVERTED (paralelo ao LeadStatus) |
| **Sales Memory** | budget, produto, urgência, cidade, pagamento, última objeção |
| **Lead Scoring** | 0–100 (espelha `Lead.score`) |
| **Objection Engine** | CARO, SEM_TEMPO, PRECISO_PENSAR, VER_COM_SOCIO, COMPARANDO… |
| **Next Best Action** | Nunca encerrar sem objetivo (perguntar / propor / agendar / escalar) |
| **Purchase Signals** | Detectar intenção; registrar oportunidade; **não** auto-converter no MVP |

---

## 5. Relação com o CRM atual

- `LeadStatus` (NEW…CONVERTED/LOST) **permanece** a verdade do CRM.  
- Sales Stage é estado **interno do agente por conversa**.  
- Default: agente **sugere** mudanças de status; não converte sozinho.

---

## 6. Roadmap (pós-aprovação)

| Fatia | Foco | Esforço | Risco | ROI |
|-------|------|---------|-------|-----|
| **11E.1** | Sales memory | M | Médio | Alto (base) |
| **11E.2** | Lead scoring | S–M | Baixo–médio | Alto |
| **11E.3** | Objection engine | M | Médio | Alto |
| **11E.4** | Next best action | M–L | Alto | Muito alto |
| **11E.5** | Purchase intent + Sales Dashboard | M | Médio–alto | Muito alto |

**Nota:** o MVP antigo chamava 11E de “ROI Dashboard”. Aqui o ROI/receita entram no **AI Sales Dashboard** (11E.5); ledger OpenAI detalhado pode ser addendum se couber.

---

## 7. Riscos principais

Pressão excessiva · spam · alucinação de preço/promessa · falso “quero comprar” · memória errada.

**Mitigações já alinhadas ao produto:** KB grounding, ASSIST default, guardrails AUTO, stop do Recovery, handoff em COMPLAINT/HUMAN, sem auto-CONVERT no MVP.

---

## 8. Decisões pedidas à aprovação

1. Congelar Sales Stages + campos de memória (design §1–2).  
2. Memória inicial em metadata da conversa (sem migration nesta aprovação).  
3. Sem auto-CONVERT no 11E.  
4. Ordem 11E.1 → … → 11E.5 sem pular NBA antes da memória.  
5. Autorizar (ou não) include de custo OpenAI no mesmo epic.

---

## 9. O que esta etapa **não** faz

- ❌ Código  
- ❌ Migrations / schema  
- ❌ PR de implementação  

Só design. **Aguardar aprovação** para iniciar 11E.1.
