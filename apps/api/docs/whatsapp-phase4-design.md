# WhatsApp Phase 4 Design — FollowUp Automation

**Status:** Design para aprovação (**sem implementação**)  
**Fase:** WhatsApp 4 — FollowUp Automation  
**Pré-requisitos:** Fase 3 Outbound Engine (`WhatsappSendService`) + FollowUp MVP  
**Base:** `whatsapp-design.md` (D6, D10) + `whatsapp-phase3-design.md` + `followups-design.md`  
**Restrição:** somente documentação nesta etapa — **sem código**.

---

## 1. Objetivo

Transformar o FollowUp Engine de “persist-only” (Message OUTBOUND local) em um mecanismo **real de envio WhatsApp**, reutilizando o Outbound Engine da Fase 3.

```text
FollowUp
  → approve
  → scheduled (opcional)
  → execute
  → WhatsApp Send (WhatsappSendService)
  → Evolution
  → Message OUTBOUND (PENDING→SENT|FAILED)
  → FollowUp EXECUTED | FAILED
```

**Fora da Fase 4 (não implementar neste design/fase):**
- IA gerando SUGGESTED automaticamente (Fase 5)  
- n8n / Dashboard novos  
- BullMQ obrigatório (MVP pode ser sync no `execute`; fila = evolução)  
- Outbound manual (`POST /whatsapp/send`) — já Fase 3  
- Alterar regras de aprovação humana (D10: humano aprova antes de enviar)

---

## 2. Arquitetura completa

```text
┌──────────────┐   JWT.cid    ┌─────────────────────┐
│  Cliente /   │ ───────────► │ FollowUpsController │
│  Agente      │  /execute    │ OWNER|ADMIN|AGENT   │
└──────────────┘              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ FollowUpsService    │
                              │  approve / schedule │
                              │  execute (orquestra)│
                              └──────────┬──────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
           ┌────────────────┐  ┌──────────────────┐  ┌──────────────┐
           │ Prisma         │  │ WhatsappSend     │  │ AuditService │
           │ FollowUp       │  │ Service.send()   │  │              │
           │ Lead           │  │  (Fase 3)        │  └──────────────┘
           │ Conversation   │  └────────┬─────────┘
           │ Message        │           │
           └────────────────┘           ▼
                               ┌──────────────────┐
                               │ EvolutionClient  │
                               │ sendText         │
                               └──────────────────┘
```

### 2.1 Princípios

1. **Não duplicar** lógica de Evolution — só chamar `WhatsappSendService.send`.  
2. **Tenant = JWT.cid** em todo o fluxo autenticado.  
3. **Aprovação humana obrigatória** antes de execute (D10).  
4. **Idempotência de execute** via transição condicional `APPROVED|SCHEDULED → EXECUTING` (uma vez).  
5. Message OUTBOUND continua dona do ciclo PENDING/SENT/DELIVERED/READ/FAILED (Fase 3).  
6. FollowUp `resultMessageId` aponta para a Message criada pelo send.

### 2.2 Componentes

| Componente | Papel na Fase 4 |
|---|---|
| `FollowUpsService.execute` | Troca persist-local por orquestração WhatsApp |
| `WhatsappSendService.send` | Envio real (reutilizado; sem fork) |
| `FollowUp.status` | Inclui `EXECUTING` / `FAILED` de verdade |
| Webhook delivery (Fase 3) | Atualiza Message; **não** muda FollowUp (salvo opcional futuro) |
| Scheduler (opcional) | Worker futuro para `SCHEDULED` quando `scheduledAt <= now` |

---

## 3. Fluxo detalhado

### 3.1 Ciclo feliz

```text
1. SUGGESTED (humano ou IA futura cria FollowUp)
2. POST /follow-ups/:id/approve
     → status = APPROVED
     → approvedBy / approvedAt
     → se dto.scheduledAt no futuro → pode ir direto a SCHEDULED (P4-A1)
3. (Opcional) POST /follow-ups/:id/reschedule
     → status = SCHEDULED
     → scheduledAt = novo
4. POST /follow-ups/:id/execute   (manual agora; job futuro para due)
     a. Validar companyId = JWT.cid
     b. Validar status ∈ {APPROVED, SCHEDULED}
     c. Validar conversationId presente
     d. Validar suggestedBody não vazio
     e. updateMany condicional → EXECUTING (anti double-execute)
     f. Chamar WhatsappSendService.send({
          leadId: followUp.leadId,
          conversationId: followUp.conversationId,
          body: followUp.suggestedBody
        })
     g. Sucesso:
          → FollowUp EXECUTED
          → executedAt = now
          → resultMessageId = messageId do send
          → Audit FOLLOWUP_EXECUTE (+ já WHATSAPP_MESSAGE_SENT do send)
     h. Falha (exception do send / 409 CONNECTED / 502 Evolution):
          → FollowUp FAILED
          → cancelReason ou metadata.lastError = mensagem
          → resultMessageId = messageId se Message FAILED foi criada
          → Audit FOLLOWUP_EXECUTE_FAILED (novo) / manter FOLLOWUP_EXECUTE com after.FAILED
5. Message segue acks Fase 3 (DELIVERED/READ) independentemente do FollowUp
```

### 3.2 Diagrama

```text
SUGGESTED ──approve──► APPROVED ──reschedule──► SCHEDULED
                           │                        │
                           └──────── execute ───────┘
                                      │
                                      ▼
                                 EXECUTING
                                   │    │
                          success  │    │  failure
                                   ▼    ▼
                              EXECUTED  FAILED

SUGGESTED ──reject──► REJECTED
APPROVED|SCHEDULED|SUGGESTED ──cancel──► CANCELLED  (P4-C1)
```

### 3.3 Premissas de execute

| Premissa | Se falhar |
|---|---|
| FollowUp da company | 404 |
| Status APPROVED ou SCHEDULED | 409 |
| `conversationId` set | 400 |
| Conversation OPEN/IDLE (regra send P3-C2) | 400 do send → FollowUp FAILED |
| Lead ativo + phone | 404/400 do send → FAILED |
| Instance CONNECTED | 409 do send → FAILED (ou 409 sem marcar FAILED — **P4-F1**) |
| `suggestedBody` | 400 |

**P4-F1 recomendação:** se instance ≠ CONNECTED, **não** gastar transição EXECUTING irreversível sem recover — ou: EXECUTING→FAILED com motivo `WHATSAPP_NOT_CONNECTED` e permitir retry (ver §5).

### 3.4 Contrato interno com Outbound

```ts
// Pseudocódigo — implementação futura
await tx.followUp.updateMany({
  where: { id, companyId, status: { in: ['APPROVED', 'SCHEDULED'] } },
  data: { status: 'EXECUTING' },
});
// se count=0 → 409 already executing/executed

try {
  const sent = await whatsappSend.send(actor, {
    leadId: followUp.leadId,
    conversationId: followUp.conversationId!,
    body: followUp.suggestedBody!,
  });
  // EXECUTED + resultMessageId
} catch (e) {
  // FAILED + error
}
```

**Importante:** `WhatsappSendService` cria a Message. Execute **não** cria Message local paralela (eliminar `MESSAGE_CREATE` local do execute atual).

---

## 4. Estados

Estados no escopo da Fase 4 (pedido + schema existente):

| Status | Significado | Quem define |
|---|---|---|
| `SUGGESTED` | Rascunho / sugestão aguardando aprovação | create / IA futura |
| `APPROVED` | Humano aprovou; pronto para schedule ou execute | approve |
| `SCHEDULED` | Agendado para `scheduledAt` | approve com data / reschedule |
| `EXECUTING` | Envio WhatsApp em andamento | execute (início) |
| `EXECUTED` | Send retornou sucesso (Message SENT) | execute (sucesso) |
| `FAILED` | Send falhou ou precondição fatal após EXECUTING | execute (erro) |
| `CANCELLED` | Cancelado antes do envio | cancel (P4-C1) |

Estados já no enum Prisma, fora do fluxo principal desta fase (manter):

| Status | Uso |
|---|---|
| `REJECTED` | reject a partir de SUGGESTED (já existe) |
| `SKIPPED` | Reservado (não usar na Fase 4) |

### 4.1 Transições permitidas (proposta)

| De | Para | Ação |
|---|---|---|
| SUGGESTED | APPROVED | approve |
| SUGGESTED | REJECTED | reject |
| SUGGESTED | CANCELLED | cancel |
| APPROVED | SCHEDULED | reschedule / approve+schedule |
| APPROVED | EXECUTING | execute |
| APPROVED | CANCELLED | cancel |
| SCHEDULED | SCHEDULED | reschedule |
| SCHEDULED | EXECUTING | execute |
| SCHEDULED | CANCELLED | cancel |
| EXECUTING | EXECUTED | send ok |
| EXECUTING | FAILED | send fail |
| FAILED | SCHEDULED / APPROVED | retry (P4-R1) |
| EXECUTED | * | **terminal** |
| REJECTED / CANCELLED | * | **terminal** (salvo recreate) |

### 4.2 Relação FollowUp.status × Message.status

| FollowUp | Message típica |
|---|---|
| EXECUTING | PENDING (breve) |
| EXECUTED | SENT (depois DELIVERED/READ via webhook) |
| FAILED | FAILED (se send chegou a criar Message) ou sem Message |

FollowUp **não** muda para refletir DELIVERED/READ do Message nesta fase (P4-M1: não acoplar).

---

## 5. Estratégia de retry

### 5.1 Problema

Execute pode falhar por: Evolution down, instance desconectada, timeout, número inválido, race double-click.

### 5.2 Regras propostas

| Caso | Retry? | Como |
|---|---|---|
| Double-execute (já EXECUTING/EXECUTED) | Não | `updateMany` count=0 → 409 |
| FAILED por `WHATSAPP_NOT_CONNECTED` | Sim | Re-aprovar path: FAILED → APPROVED/SCHEDULED (P4-R1) + execute de novo |
| FAILED por Evolution 5xx / timeout | Sim | Mesmo retry manual; **nova** Message no próximo send (P3 não reusa FAILED) |
| FAILED por validação (body vazio, conv closed) | Sim após corrigir dados | Patch conversation / body se permitido |
| EXECUTED | Não | Terminal |
| PENDING Message órfã (>5 min, P3-D3) | Ops | Não altera FollowUp automaticamente |

### 5.3 Retry automático (escopo)

**P4-R2 recomendação Fase 4:** **somente retry manual** via API (`POST .../retry` ou re-`execute` após voltar a APPROVED/SCHEDULED).  
Retry automático com backoff = fase futura + fila.

### 5.4 Endpoint de retry (proposta)

```http
POST /api/follow-ups/:id/retry
```

- Só se status = `FAILED`  
- Transiciona para `APPROVED` (ou `SCHEDULED` se `scheduledAt` futuro)  
- Não envia sozinho — agente chama `execute` em seguida  
**Ou** retry = execute que aceita FAILED→EXECUTING direto (**P4-R3**)

**Recomendação P4-R3:** `execute` aceita `FAILED` além de APPROVED/SCHEDULED, com o mesmo `updateMany` condicional → EXECUTING. Mais simples (sem endpoint novo).

### 5.5 Limite de tentativas

| Campo conceitual | Proposta |
|---|---|
| `metadata.retryCount` | Incrementar a cada EXECUTING |
| Máximo MVP | **3** tentativas; depois FAILED terminal até intervenção |
| Audit | Cada tentativa com before/after |

**P4-R4:** max 3 retries — sim/não (recomendado sim).

---

## 6. Estratégia de auditoria

### 6.1 Actions existentes (manter)

| Action | Quando |
|---|---|
| `FOLLOWUP_CREATE` | create |
| `FOLLOWUP_UPDATE` | patch |
| `FOLLOWUP_APPROVE` | approve |
| `FOLLOWUP_REJECT` | reject |
| `FOLLOWUP_RESCHEDULE` | reschedule |
| `FOLLOWUP_EXECUTE` | execute concluído (sucesso) |

### 6.2 Actions novas / ajustes Fase 4

| Action | Quando |
|---|---|
| `FOLLOWUP_EXECUTE` | after.status = EXECUTED + resultMessageId |
| `FOLLOWUP_EXECUTE_FAILED` | after.status = FAILED + error |
| `FOLLOWUP_CANCEL` | cancel → CANCELLED |
| `FOLLOWUP_RETRY` | FAILED → APPROVED/SCHEDULED/EXECUTING (se endpoint separado) |

Do Outbound (já Fase 3, mesma request):

| Action | Quem |
|---|---|
| `WHATSAPP_MESSAGE_SENT` | WhatsappSendService (USER actor) |
| `WHATSAPP_MESSAGE_FAILED` | WhatsappSendService |

**Remover** do execute: audit `MESSAGE_CREATE` local (substituído pelo send).

### 6.3 Mesma transação?

- Transição EXECUTING: tx curta própria (commit antes do I/O Evolution).  
- EXECUTED/FAILED: tx após retorno do send, referenciando `resultMessageId`.  
- Audits FollowUp na tx de status final.  
- Audits Message já feitas dentro do send.

---

## 7. Estratégia de multi-tenancy

| Regra | Detalhe |
|---|---|
| FollowUp queries | Sempre `companyId = JWT.cid` |
| Lead / Conversation | Validação indireta via send + checks locais com cid |
| WhatsApp instance | Resolvida dentro do send por cid (D1: 1:1) |
| Webhook | Fora do execute; tenant via instanceKey (Fases 2–3) |
| `companyId` no body | Proibido |
| Cross-tenant followUp id | 404 |
| Agent company A | Não executa FollowUp de B |
| resultMessageId | Message.companyId deve == FollowUp.companyId (assert) |

Execute **nunca** passa `companyId` para Evolution — só instance da company.

---

## 8. Integração com Outbound Engine

### 8.1 Reuso obrigatório

```text
FollowUpsService.execute
  → WhatsappSendService.send(actor, { leadId, conversationId, body })
```

Não chamar `EvolutionClient` direto do módulo FollowUp.

### 8.2 Mapeamento de erros do send

| Erro send | FollowUp |
|---|---|
| 404 Lead/Conversation | FAILED + motivo |
| 400 Conversation CLOSED | FAILED + motivo |
| 409 not CONNECTED | FAILED ou 409 sem EXECUTING — P4-F1 |
| 502 Evolution | FAILED + messageId se houver |
| 200 SENT | EXECUTED |

### 8.3 Metadata / rastreio

```text
FollowUp.resultMessageId = sent.messageId
Message.metadata.source = 'followup_execute'  (P4-S1: estender send com source opcional)
Message.metadata.followUpId = followUp.id
```

**P4-S1 recomendação:** adicionar parâmetro opcional `source` / `metadata` em `WhatsappSendService.send` sem quebrar `/whatsapp/send`.

### 8.4 Scheduler futuro (fora do MVP sync)

```text
Job (cron/queue):
  find FollowUp SCHEDULED where scheduledAt <= now and company active
  for each: execute interno (system actor?) 
```

**P4-Q1:** Fase 4 MVP = execute **manual** sync apenas. Job SCHEDULED = opcional stretch ou Fase 4.1.

---

## 9. Tratamento de falhas

| Falha | Comportamento |
|---|---|
| Race double execute | Segundo request 409; só um EXECUTING |
| Crash após EXECUTING antes de send | FollowUp preso em EXECUTING → job de reconciliação (P4-X1) ou timeout → FAILED |
| Send cria FAILED Message | FollowUp FAILED + resultMessageId |
| Send lança antes de criar Message | FollowUp FAILED sem resultMessageId |
| Echo/webhook após EXECUTED | Só Message; FollowUp intacto |
| Instance cai no meio | FAILED; retry quando CONNECTED |
| suggestedBody alterado após APPROVED | Hoje patch limitado; manter: body congelado após approve (já regra MVP) |

### 9.1 Reconciliação EXECUTING órfão (P4-X1)

**Proposta:** se `EXECUTING` e `updatedAt` > 5 minutos sem `resultMessageId`:

- Marcar `FAILED` com motivo `EXECUTING_TIMEOUT`  
- Alinhado ao PENDING>5min da Fase 3 (P3-D3)  
- Implementação: endpoint admin/cron futuro; documentar como critério ops

---

## 10. Critérios de aceite (implementação futura)

- [ ] `execute` chama `WhatsappSendService.send` (não cria Message local)  
- [ ] Transição `APPROVED|SCHEDULED → EXECUTING → EXECUTED|FAILED`  
- [ ] `resultMessageId` preenchido no sucesso (e no FAILED com Message)  
- [ ] Idempotência: segundo execute não reenvia  
- [ ] Instance ≠ CONNECTED tratado de forma definida (P4-F1)  
- [ ] Audits FOLLOWUP_EXECUTE / FOLLOWUP_EXECUTE_FAILED + audits WhatsApp  
- [ ] Multi-tenant: só JWT.cid  
- [ ] Retry conforme P4-R3/R4  
- [ ] REJECTED/CANCELLED não executáveis  
- [ ] Sem IA auto-send  
- [ ] `docs/whatsapp-phase4-review.md`  
- [ ] Testes: sucesso stub Evolution, falha CONNECTED, double-execute, cross-tenant  

---

## 11. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| Double send WhatsApp | Crítica | EXECUTING condicional antes do I/O |
| FollowUp EXECUTED mas Message FAILED | Alta | Só EXECUTED se send retorna ok |
| FollowUp FAILED mas Message SENT | Alta | Catch só em exception; sucesso HTTP do send = EXECUTED |
| EXECUTING eterno (crash) | Média | Timeout P4-X1 |
| Agent executa sem CONNECTED | Média | Erro claro; retry depois |
| Acoplar FollowUp a READ receipts | Baixa | Não fazer (P4-M1) |
| Bypass aprovação | Crítica | Execute só APPROVED/SCHEDULED/FAILED(retry) |
| Vazamento cross-tenant | Crítica | cid em todas as queries |
| Scheduler spam | Média | Fora do MVP; locks por id |
| Divergência body FollowUp vs Message | Baixa | body imutável pós-approve |

---

## 12. Impactos em módulos existentes

| Módulo | Mudança Fase 4 |
|---|---|
| FollowUpsService.execute | Reescrever orquestração |
| WhatsappSendService | Opcional metadata/source (P4-S1) |
| Conversations createMessage | Intocado (local outbound permanece para outros usos) |
| Dashboard | Contadores EXECUTED/FAILED reais com WhatsApp |
| IA Fase 5 | Continuará criando SUGGESTED; execute permanece humano |

---

## 13. Decisões pedindo aprovação explícita

| ID | Pergunta | Recomendação |
|---|---|---|
| **P4-A1** | Approve com `scheduledAt` futuro → SCHEDULED direto? | **Sim** |
| **P4-C1** | Endpoint cancel → CANCELLED? | **Sim** (APPROVED/SCHEDULED/SUGGESTED) |
| **P4-F1** | not CONNECTED: FAILED ou 409 sem EXECUTING? | **409 sem EXECUTING** (não consome retry) |
| **P4-R3** | execute aceita FAILED para retry? | **Sim** |
| **P4-R4** | Max 3 tentativas? | **Sim** (`metadata.retryCount`) |
| **P4-R2** | Retry automático? | **Não** nesta fase |
| **P4-S1** | metadata.source=`followup_execute` no send? | **Sim** |
| **P4-M1** | FollowUp reage a DELIVERED/READ? | **Não** |
| **P4-Q1** | Job para SCHEDULED due? | **Não** no MVP (manual execute) |
| **P4-X1** | Timeout EXECUTING > 5 min → FAILED? | **Sim** (doc + job simples ou check lazy) |

---

## 14. Relação com roadmap WhatsApp

| Fase | Estado |
|---|---|
| 1 Conexão | Feita |
| 2 Inbound | Feita |
| 3 Outbound | Feita |
| **4 FollowUp Automation** | **Este design** |
| 5 IA assistiva | Sugere → humano aprova → execute (este motor) |

---

## 15. Próximo passo

**Aguardar aprovação** deste design (e P4-A1…P4-X1).  
Somente após aprovação explícita → implementar FollowUp → WhatsApp Send.  
**Nenhum código nesta etapa.**

---

*Fim do design WhatsApp Fase 4.*
