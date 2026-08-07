# Business Readiness Audit — SaaS Autoatendido

**Tipo:** auditoria de negócio / produto (somente documentação — sem implementação)  
**Data:** 2026-08-07  
**Pergunta:** o que falta para o Autopilot ser um **SaaS autoatendido** (cliente chega sozinho, ativa, paga e permanece)?  
**Fora de escopo:** arquitetura, backend, código infra.  
**Premissa:** piloto assistido já é viável; este doc avalia o salto para **self-serve**.

---

## Veredito

| Destino | Status |
|---------|--------|
| Piloto assistido | Possível com ops Autopilot |
| Piloto pago acompanhado | Condicional |
| **SaaS autoatendido** | **NO-GO** |

O produto operacional (CRM + WhatsApp + follow-ups) existe. O **funil comercial self-serve** (chegar → criar conta → ativar → pagar → renovar → pedir ajuda) **não**.

| Dimensão | Prontidão self-serve |
|----------|----------------------|
| 1. Aquisição | **Bloqueada** |
| 2. Onboarding | **Parcial** (só após conta provisionada) |
| 3. Ativação | **Parcial** (WhatsApp e time ainda friccionam) |
| 4. Conversão em pagante | **Bloqueada** |
| 5. Retenção | **Fraca para self-serve** |
| 6. Cobrança | **Inexistente** |
| 7. Suporte | **Só ferramenta interna** |

---

## Legenda

| | Significado |
|---|-------------|
| **Já existe** | O cliente (ou champion) consegue usar no produto hoje |
| **Falta** | Ausente ou depende de processo humano da Autopilot |
| **Obrigatório (P0)** | Sem isso, SaaS aberto não abre |
| **Pode esperar (P1/P2)** | Melhora conversão/retenção, mas não é o primeiro portão |

---

## 1. Aquisição

*Como um prospect descobre e inicia o uso sem a ops Autopilot?*

### Já existe
- Marca e copy comercial no login (Product Polish)
- Produto utilizável **depois** que alguém já tem login

### Falta
- Site / landing pública de conversão
- Signup / “Criar conta”
- Trial com prazo ou créditos
- Conteúdo de aquisição (cases, pricing page, SEO)
- Cadastro self-serve sem e-mail provisionado pela ops

### Obrigatório — **P0**
| Item | Por quê |
|------|---------|
| Signup público (e-mail + senha ou magic link) | Sem isso não há aquisição self-serve |
| Página mínima de entrada (landing ou CTA “Começar”) | Prospect precisa de caminho sem sales call |

### Pode esperar
| Item | Sev | Por quê |
|------|-----|---------|
| Pricing page pública | **P1** | Pode vender 1:1 no início; self-serve precisa depois |
| Cases / blog / SEO | **P2** | Aceleram aquisição, não abrem o portão |
| SSO Google/Microsoft | **P2** | Conveniência B2B; e-mail/senha basta no dia 1 |

**Classificação da dimensão:** bloqueada para SaaS aberto.

---

## 2. Onboarding

*Primeiros passos até a empresa existir e o time poder entrar.*

### Já existe
- Wizard **Primeiros passos** (`/setup`): criar empresa → convidar → WhatsApp → conclusão
- Seleção de empresa se houver mais de uma
- Limite claro: 1 empresa por usuário (comportamento atual do produto)
- Settings da empresa (nome, locale, fuso, horários, logo URL)

### Falta
- Cadastro do OWNER sem ops
- Convite com e-mail real + aceite (hoje `delivery: NONE` — ativação offline)
- Recuperação / troca de senha no primeiro acesso
- Checklist de sucesso visível no dia a dia (“conecte WhatsApp”, “importe leads”, “convide 1 agente”)
- Onboarding guiado pós-setup (empty states com próximos passos em todas as áreas críticas — parcialmente coberto pelo Polish)

### Obrigatório — **P0**
| Item | Por quê |
|------|---------|
| Fluxo completo: signup → criar empresa → entrar no app **sem humano** | Define onboarding self-serve |
| Convite com entrega + definir senha / aceitar | Time não escala se só o OWNER entra |

### Pode esperar
| Item | Sev | Por quê |
|------|-----|---------|
| Tours / tooltips / checklist persistente | **P1** | Acelera; wizard + empty states ajudam no curto prazo |
| Multi-empresa livre / orgs | **P2** | Modelo atual 1:1 serve SMB no início |
| Importação em massa de leads no setup | **P2** | Pode criar leads um a um no piloto |

**Classificação da dimensão:** parcial — wizard existe, mas começa “no meio” do funil.

---

## 3. Ativação

*Momento em que o cliente sente valor: canal vivo + operação diária.*

### Já existe
- Conectar WhatsApp (QR) na UI
- Leads + Lead Workspace (notas, atividades, timeline, responsável)
- Conversas e mensagens (CRM / WhatsApp)
- Follow-ups (aprovar, agendar, executar, reagendar)
- Funil (KPI), dashboard, exportações
- Papéis OWNER / ADMIN / AGENT

### Falta
- Garantia de “WhatsApp conectou de primeira” sem suporte Autopilot
- IA no produto (sugestão de resposta) — capacidade comercial se estiver no pitch
- Criar conversa sem colar identificador técnico do lead
- Soft delete / limpeza de base na UI
- Bulk-assign de carteira na UI
- Momento “aha” medido (ex.: 1º inbound + 1º outbound + 1º follow-up executado)

### Obrigatório — **P0**
| Item | Por quê |
|------|---------|
| WhatsApp self-serve confiável (conectar → receber → enviar) | Sem canal, não há ativação do core |
| Pelo menos um ciclo comercial completo sem ops | Lead → conversa → follow-up → envio |

### Pode esperar
| Item | Sev | Por quê |
|------|-----|---------|
| Botão “Sugerir com IA” | **P1** | Ativa se IA for na oferta; senão P2 |
| Picker de lead ao criar conversa | **P1** | UX; não bloqueia se o time usar atalho do workspace |
| Cancel follow-up na UI | **P1** | Higiene operacional |
| Bulk-assign / soft delete | **P2** | Escala de time; piloto pequeno vive sem |
| Kanban drag-and-drop | **P2** | Funil KPI já entrega visão |

**Classificação da dimensão:** parcial — ativação funciona com acompanhamento; frágil sozinha.

---

## 4. Conversão em cliente pagante

*Do uso gratuito / trial para “vou pagar por isso”.*

### Já existe
- Produto com valor operacional demonstrável (CRM + WA + FU)
- Papel de champion (OWNER) claro
- Exportações e diagnostics (confiança operacional)

### Falta
- Trial com data de fim / limites visíveis
- Paywall ou upgrade in-app
- Planos (Starter / Pro) e limites por plano (usuários, números WA, volume)
- Checkout / “Assinar”
- Prova social e ROI in-app (relatórios de conversão comerciais)
- Contrato / termos / aceite digital no fluxo de compra

### Obrigatório — **P0**
| Item | Por quê |
|------|---------|
| Oferta clara (plano + preço) acessível no produto ou página | Sem oferta não há conversão self-serve |
| Momento de cobrança (checkout ou “falar com vendas” mínimo no app) | Precisa de um caminho para virar pagante |

> Em modelo **sales-assisted**, “falar com vendas” pode ser P0 comercial; em **SaaS autoatendido**, checkout self-serve é P0.

### Pode esperar
| Item | Sev | Por quê |
|------|-----|---------|
| Comparador de planos sofisticado | **P1** | Um plano único + add-on basta no início |
| Coupons / annual discount | **P2** | Otimização |
| Marketplace / parceiros | **P2** | Depois do core |

**Classificação da dimensão:** bloqueada — não há caminho de compra no produto.

---

## 5. Retenção

*Por que o cliente volta na semana 2 e no mês 3?*

### Já existe
- Operação diária rica (workspace, conversas, follow-ups)
- Empty/error states e copy em português (menos abandono por confusão)
- Export CSV (dados não ficam “presos” sem saída)
- Setup / diagnostics para saúde do canal

### Falta
- E-mails de lifecycle (não ativou WA, trial acabando, QR caiu)
- Alertas in-app de saúde (WhatsApp desconectou)
- Relatórios de valor (quanto foi respondido / follow-ups executados)
- Sucesso guiado pós-ativação (playbooks no produto)
- LGPD self-serve (exclusão / retenção) — confiança enterprise
- Comunidade / changelog / novidades

### Obrigatório — **P0**
| Item | Por quê |
|------|---------|
| Recuperação quando WhatsApp cai (aviso claro + reconectar) | Churn #1 em produto canal |
| Dados do cliente exportáveis (já parcial) + caminho de saída honesto | Confiança mínima |

### Pode esperar
| Item | Sev | Por quê |
|------|-----|---------|
| E-mails de lifecycle / trial ending | **P1** | Crítico com trial; menos se sales-led |
| NPS / in-app feedback | **P1** | Aprende retenção |
| Relatórios de ROI | **P1** | Sustenta renovação |
| Comunidade / academy | **P2** | Escala suporte e retenção |
| LGPD delete self-serve completo | **P1** (P0 se vender enterprise regulado) | |

**Classificação da dimensão:** fraca para self-serve — retenção depende de hábito operacional + canal estável, sem loops de produto.

---

## 6. Cobrança

*Como o dinheiro entra e se renova sem planilha.*

### Já existe
- Nada de billing no produto (sem planos, invoices, portal do cliente)

### Falta
- Provedor de pagamento (cartão / boleto / Pix conforme mercado)
- Assinatura recorrente
- Portal “Minha assinatura” (trocar plano, método, cancelar)
- Notas fiscais / recibos (conforme jurisdição)
- Limites enforcement (usuários, instâncias WA)
- Dunning (falha de pagamento → aviso → bloqueio graceful)
- Trial → paid automático

### Obrigatório — **P0**
| Item | Por quê |
|------|---------|
| Cobrança recorrente self-serve **ou** processo comercial explícito no app | Sem cobrança não há SaaS |
| Portal básico de assinatura | Cliente precisa gerir pagamento sem ticket |
| Estados: trial / active / past_due / canceled refletidos no app | Evita uso eterno grátis |

### Pode esperar
| Item | Sev | Por quê |
|------|-----|---------|
| Multi-moeda / multi-país | **P2** | Começar BR |
| Usage-based billing | **P2** | Seat-based é mais simples |
| Marketplace de add-ons | **P2** | Depois do core |

**Classificação da dimensão:** inexistente.

---

## 7. Suporte

*Como o cliente se desbloqueia sozinho ou com o time certo.*

### Já existe
- Diagnósticos no app (saúde de serviços / WhatsApp / workers)
- Empty/error amigáveis (menos “abra ticket por confusão”)
- Roles claros (OWNER resolve admin; AGENT opera)
- Runbooks internos Autopilot (ops) — **não** self-serve do cliente

### Falta
- Central de ajuda / FAQ in-app ou site
- Canal de suporte visível (chat, e-mail, status page)
- Audit / histórico de incidentes acessível ao admin do cliente
- Status page pública (WhatsApp/API fora)
- SLA e filas (L1/L2) para escala
- Impersonation / “ver como o cliente” para suporte Autopilot (processo)

### Obrigatório — **P0**
| Item | Por quê |
|------|---------|
| Canal de suporte anunciado no produto (mesmo que e-mail) | Self-serve sem ajuda = churn |
| Diagnóstico acionável (“WhatsApp desconectado → reconectar”) | Já parcial; precisa ser o caminho feliz do suporte L0 |

### Pode esperar
| Item | Sev | Por quê |
|------|-----|---------|
| Help center / artigos | **P1** | Reduz tickets |
| Status page | **P1** | Confiança em incidentes de canal |
| Audit/reconcile na UI do cliente | **P2** (P1 para suporte Autopilot interno) | |
| Chat in-app | **P2** | E-mail + docs bastam cedo |

**Classificação da dimensão:** ferramenta interna pronta; suporte de produto self-serve ainda não.

---

## Matriz consolidada P0 / P1 / P2

### P0 — sem isso não abre SaaS autoatendido

1. Signup público  
2. Onboarding completo sem ops (conta → empresa → app)  
3. Convite com e-mail + ativação pelo convidado  
4. WhatsApp self-serve confiável (conectar / receber / enviar)  
5. Caminho de cobrança (checkout ou assinatura) + estados de plano no app  
6. Portal mínimo de assinatura / cancelamento  
7. Canal de suporte visível + reconexão clara de WhatsApp  

### P1 — necessário para converter e reter em escala

1. Pricing / planos visíveis  
2. Trial com fim e limites  
3. Lifecycle e-mail (ativação, trial ending, WA down)  
4. IA na conversa **se** fizer parte da oferta  
5. Picker de lead / cancel FU / higiene operacional  
6. Help center + status page  
7. Relatórios de valor / NPS  
8. LGPD delete/export self-serve (subir a P0 se mercado exigir)

### P2 — pode esperar pós-abertura

1. SEO / content / cases  
2. SSO  
3. Kanban, bulk-assign, soft delete UI  
4. Usage-based billing, coupons, multi-país  
5. Community / academy  
6. Chat in-app, audit avançado no app do cliente  

---

## O que já dá para vender (sem ser SaaS aberto)

| Modelo | Viável? | Condição |
|--------|---------|----------|
| Piloto assistido | Sim | Ops provisiona OWNER; ativa WA; convites offline |
| Piloto pago 1:1 | Condicional | Mesmo + preço fechado fora do app + acompanhamento |
| Self-serve plg | **Não** | Faltam P0 de aquisição, convite, cobrança |

---

## Sequência de negócio sugerida (não técnica)

```text
1. Fechar aquisição + onboarding self-serve (signup, convite, senha)
2. Endurecer ativação (WhatsApp “verde” sem ticket)
3. Ligar cobrança (1 plano + trial + portal)
4. Empacotar suporte L0 (help + status + reconectar WA)
5. Depois: IA no pitch, lifecycle, planos avançados
```

---

## Referências de produto (não arquitetura)

- `docs/pilot-readiness-final.md` — SaaS aberto já classificado NO-GO  
- `docs/first-pilot-playbook.md` — operação assistida atual  
- `docs/ui-showcase.md` — o que o usuário vê hoje  
- `docs/technical-debt-final.md` — gaps de superfície (IA, cancel FU, etc.) citados só como impacto de negócio  

---

## Conclusão

O Autopilot **já é um CRM operacional**. Ainda **não é um negócio SaaS autoatendido**: falta o funil de chegar, ativar time, pagar e se ajudar. Priorize os **7 P0** acima antes de qualquer abertura pública; o restante (P1/P2) otimiza conversão e retenção depois que o portão existir.
