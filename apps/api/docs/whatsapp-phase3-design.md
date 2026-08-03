# WhatsApp Phase 3 Design — Outbound Engine

**Status:** Design para aprovação (**sem implementação**)  
**Fase:** WhatsApp 3 — Outbound Engine  
**Pré-requisitos:** Fase 1 (conexão) + Fase 2 (inbound) implementadas  
**Base:** `whatsapp-design.md` (D1–D10) + Fase 2 (P2-*)  
**Restrição:** somente documentação nesta etapa — **sem código**.

---

## 1. Objetivo

Projetar o envio de mensagens WhatsApp **pelo AutoPilot** via Evolution API, com:

- Endpoint autenticado multi-tenant  
- Persistência de Message `OUTBOUND`  
- Ciclo de vida de entrega (PENDING → SENT → DELIVERED → READ / FAILED)  
- Atualização de status via webhooks Evolution  
- Echo Protection (D8) para não recriar INBOUND das próprias mensagens  

**Fora da Fase 3 (não implementar neste design/fase):**
- IA / auto-send  
- Integração completa FollowUp execute → WhatsApp (ponte documentada; implementação = Fase 4)  
- n8n / Dashboard  
- BullMQ / filas (envio **síncrono** no request; handler extraível para D3 futuro)  
- Mídia (imagem/áudio/documento) — MVP **texto**  

---

## 2. Arquitetura completa do fluxo outbound

```text
┌─────────────┐     JWT + cid      ┌──────────────────────┐
│  Cliente /  │ ─────────────────► │ WhatsappController   │
│  Dashboard  │   POST /send       │  Roles: OWNER/ADMIN/ │
└─────────────┘                    │  AGENT (proposta)    │
                                   └──────────┬───────────┘
                                              │
                                   ┌──────────▼───────────┐
                                   │ WhatsappSendService  │
                                   │  (extraível / sync)  │
                                   └──────────┬───────────┘
            ┌─────────────────────────────────┼────────────────────────────┐
            │                                 │                            │
            ▼                                 ▼                            ▼
   ┌────────────────┐              ┌──────────────────┐         ┌─────────────────┐
   │ Prisma Domain  │              │ EvolutionClient  │         │ AuditService    │
   │ Lead           │              │ sendText(...)    │         │ SYSTEM/USER     │
   │ Conversation   │              └────────┬─────────┘         └─────────────────┘
   │ Message OUTB.  │                       │
   │ WhatsAppInst.  │                       ▼
   └────────────────┘              ┌──────────────────┐
                                   │ Evolution API    │
                                   │ (Baileys/WA)     │
                                   └────────┬─────────┘
                                            │ webhooks ack
                                            ▼
                              POST /api/whatsapp/webhook/:instanceKey
                                   │
                                   ├─ messages.upsert (inbound / echo)  → Fase 2 + D8
                                   ├─ messages.update / send / ack     → Fase 3 status
                                   └─ connection.update                → Fase 1
```

### 2.1 Componentes

| Componente | Responsabilidade |
|---|---|
| `POST /api/whatsapp/send` | Entrada autenticada; valida DTO |
| `WhatsappSendService.send(...)` | Orquestra validações + Evolution + persistência |
| `EvolutionClient.sendText` | Adapter HTTP Evolution |
| `WhatsappService.handleWebhook` | Estende Fase 2: processa acks de entrega |
| `Message.status` | Ciclo PENDING/SENT/DELIVERED/READ/FAILED |
| `WebhookEvent` | Log técnico (já Fase 2) |

### 2.2 Princípios

1. **Tenant = JWT.cid** no send (nunca do body).  
2. **Instance = lookup por companyId** ativo; outbound só se `CONNECTED`.  
3. **Persistir Message antes ou imediatamente após send** com estratégia anti-echo (§6).  
4. **Idempotência:** `external_message_id` único por company (já existe); opcional `Idempotency-Key` HTTP (futuro).  
5. Sync no request nesta fase; método extraível para fila depois.

---

## 3. Endpoint proposto

```http
POST /api/whatsapp/send
Authorization: Bearer <access>
Content-Type: application/json
```

> Nota: o design geral citava `/api/whatsapp/send-message`.  
> **Fase 3 congela o path pedido:** `POST /api/whatsapp/send`.  
> (Atualizar doc geral na implementação.)

### 3.1 Auth / roles (proposta)

| Guard | Regra |
|---|---|
| `JwtAuthGuard` | Obrigatório |
| `CompanyContextGuard` | `cid` presente no JWT |
| `RolesGuard` | **OWNER \| ADMIN \| AGENT** |

Decisão a confirmar: **P3-R1** — AGENT pode enviar? **Recomendação: sim** (atendimento operacional).

### 3.2 Request body

```json
{
  "conversationId": "uuid",
  "body": "Texto da mensagem",
  "leadId": "uuid"
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `body` | Sim | string trim; 1…4096 chars (MVP texto) |
| `conversationId` | Condicional | Se informado: deve existir na company |
| `leadId` | Condicional | Se informado sem conversation: resolve/cria conversation OPEN/IDLE (D2) |

**Proposta de contrato (P3-C1):**

- **Preferido:** `conversationId` + `body`  
- **Alternativo:** `leadId` + `body` → reutilizar Conversation OPEN/IDLE WHATSAPP do lead; se não houver, **criar** OPEN (igual D2)  
- Se ambos informados: `conversation.leadId` deve == `leadId` → senão 400  
- **Proibido:** `companyId`, `instanceKey`, `phone` arbitrário no body (phone vem do Lead)

### 3.3 Response 200 (sucesso)

```json
{
  "ok": true,
  "messageId": "uuid",
  "conversationId": "uuid",
  "leadId": "uuid",
  "externalMessageId": "3EB0...",
  "status": "SENT"
}
```

### 3.4 Erros HTTP

| Caso | HTTP |
|---|---|
| Sem auth / cid | 401 |
| Role insuficiente | 403 |
| Lead/Conversation não encontrados na company | 404 |
| Conversation CLOSED/ARCHIVED (se send direto nela) | 400 ou 409 — **P3-C2** |
| Instance inexistente | 404 / 409 `WhatsApp not connected` |
| Instance ≠ `CONNECTED` | **409** `WhatsApp instance not CONNECTED` |
| Body inválido | 400 |
| Evolution timeout / 5xx | 502 ou 503; Message `FAILED` se já criada |
| Evolution rejeitou (número inválido) | 422 ou 502; Message `FAILED` |

---

## 4. Fluxo detalhado (obrigatório)

```text
1. API recebe POST /whatsapp/send (JWT)
2. companyId := JWT.cid
3. Validar body (trim, tamanho)
4. Validar Lead (companyId, deletedAt null)
     — via conversation.leadId ou leadId do DTO
5. Validar Conversation
     — se conversationId: companyId + lead match + channel WHATSAPP
     — se só leadId: resolve OPEN/IDLE (D2) ou cria
6. Validar WhatsAppInstance
     — findActiveByCompany(companyId)
     — status === CONNECTED  (senão 409)
     — phoneNumber da instance opcional para log; destino = Lead.phone
7. Criar Message OUTBOUND status=PENDING (mesma tx preparatória OU create pré-send)
8. Chamar Evolution sendText(instanceName, lead.phone, body)
9. Em sucesso:
     — externalMessageId := id Evolution
     — status := SENT
     — sentAt := now
     — Conversation.lastMessageAt := now
     — Lead.lastOutboundAt / lastContactAt := now  (recomendado P3-T1)
     — Audit WHATSAPP_MESSAGE_SENT
10. Em falha Evolution:
     — status := FAILED
     — metadata.lastError
     — Audit WHATSAPP_MESSAGE_FAILED
     — HTTP erro apropriado
11. Retornar 200 com messageId + externalMessageId + status
```

### 4.1 Ordem persistência vs Evolution (decisão)

| Opção | Prós | Contras |
|---|---|---|
| **A — Persist PENDING → send → update SENT** | Echo encontra row cedo; auditoria clara | Row órfã se crash entre create e send |
| **B — Send → persist SENT** | Sem PENDING fantasma | Race echo pode chegar antes do insert |
| **C — Persist PENDING + external temp id** | Complexo | Pouco ganho |

**Recomendação Fase 3: Opção A (P3-O1).**

```text
$transaction parcial:
  CREATE Message PENDING (externalMessageId = null)
  (fora ou após) Evolution send
  UPDATE Message → SENT + externalMessageId
  UPDATE Conversation.lastMessageAt
  UPDATE Lead timestamps
  Audit SENT
```

Se Evolution falhar após PENDING: marcar `FAILED` + audit (não deixar PENDING eterno sem erro).

Race echo (webhook chega antes do UPDATE com id): ver §6 Opção escolhida (match por id após update; fromMe ignore).

### 4.2 Campos Message OUTBOUND

| Campo | Valor |
|---|---|
| `companyId` | JWT.cid |
| `conversationId` | resolvida |
| `direction` | `OUTBOUND` |
| `body` | texto |
| `status` | `PENDING` → `SENT` (depois webhooks) |
| `contentType` | `TEXT` |
| `senderType` | `USER` (envio humano) |
| `senderUserId` | JWT.sub |
| `externalMessageId` | id Evolution (após send) |
| `sentAt` | now (quando SENT) |
| `deliveredAt` / `readAt` | via webhook |
| `metadata` | `{ evolutionInstanceName, providerResponse?, source: 'whatsapp_send' }` |

---

## 5. Estratégia de status

Estados de **Message.status** para outbound (string já no schema; valores congelados na Fase 3):

```text
PENDING ──► SENT ──► DELIVERED ──► READ
              │
              └──► FAILED
         DELIVERED / SENT também podem → FAILED (raro; documentar se Evolution reportar)
```

| Status | Significado | Quem define |
|---|---|---|
| `PENDING` | Aceito pelo AutoPilot; envio Evolution em andamento / não confirmado | API send |
| `SENT` | Evolution/WhatsApp aceitou; `externalMessageId` presente | API send (sucesso) |
| `DELIVERED` | Entregue ao dispositivo do lead | Webhook |
| `READ` | Lida (quando WhatsApp reporta) | Webhook |
| `FAILED` | Falha de envio ou falha reportada pelo provider | API send ou webhook |

### 5.1 Regras de transição

| De → Para | Permitido |
|---|---|
| PENDING → SENT | Sim |
| PENDING → FAILED | Sim |
| SENT → DELIVERED | Sim |
| SENT → READ | Sim (alguns providers pulam delivered) |
| SENT → FAILED | Sim |
| DELIVERED → READ | Sim |
| DELIVERED → FAILED | Raro; permitir se webhook failed |
| READ → * | **Não** (terminal de sucesso) |
| FAILED → SENT | **Não** no MVP (novo send = nova Message) |
| Qualquer → status “menor” | **Não** (monotonicidade) |

Implementação: update condicional  
`WHERE status IN (allowed_previous) AND companyId = …`  
para evitar regressão por webhooks fora de ordem.

### 5.2 Inbound continua com `RECEIVED`

Messages `INBOUND` mantêm `status = RECEIVED` (Fase 2).  
Os novos estados acima aplicam-se a **OUTBOUND**.  
Não misturar sem migração de significado.

### 5.3 MessageSync (D design geral)

**P3-S1 — Recomendação Fase 3:** **não** criar tabela `MessageSync` ainda.  
Usar `Message.status` + `sentAt` / `deliveredAt` / `readAt` + `metadata`.  
Reavaliar MessageSync se histórico de acks ficar rico demais.

---

## 6. Estratégia de atualização por webhook

Evolution/Baileys tipicamente emitem atualizações de ack. Mapear eventos conceituais:

| Evento conceitual | Status alvo | Campos |
|---|---|---|
| `message.sent` / ack=1 | `SENT` (se ainda PENDING) | `sentAt` |
| `message.delivered` / ack=2 | `DELIVERED` | `deliveredAt` |
| `message.read` / ack=3 | `READ` | `readAt` |
| `message.failed` / erro | `FAILED` | `metadata.error` |

### 6.1 Fluxo webhook de status

```text
POST /webhook/:instanceKey + secret
  → resolver instance → companyId
  → registrar WebhookEvent
  → se evento de ack/status de mensagem:
       extrair externalMessageId
       find Message WHERE companyId + externalMessageId + OUTBOUND
       se não achar → IGNORED (pode ser msg externa/não-AutoPilot)
       se achar → transition status (monotônico) + timestamps
       Audit WHATSAPP_MESSAGE_DELIVERED | READ | FAILED | (SENT se PENDING→SENT)
  → 200
```

### 6.2 Assinatura de eventos Evolution (proposta)

Estender `setWebhook` / events:

```text
CONNECTION_UPDATE
MESSAGES_UPSERT          (Fase 2)
MESSAGES_UPDATE         (acks — confirmar nome na Evolution v2)
```

Nomes reais variam (`messages.update`, `SEND_MESSAGE`, etc.).  
Na implementação: normalizar em `mapDeliveryUpdate(payload)` com fixtures de stub.

### 6.3 Idempotência de ack

- Mesmo ack reenviado: no-op se status já ≥ alvo  
- WebhookEvent `external_event_id` quando disponível  
- Não criar Message nova a partir de ack  

### 6.4 Audits de entrega

| Transição | Audit action |
|---|---|
| → SENT (via webhook, se aplicável) | `WHATSAPP_MESSAGE_SENT` (só se ainda não auditado no send; evitar duplicar — **P3-A1**) |
| → DELIVERED | `WHATSAPP_MESSAGE_DELIVERED` |
| → READ | `WHATSAPP_MESSAGE_READ` |
| → FAILED | `WHATSAPP_MESSAGE_FAILED` |

**P3-A1 recomendação:**  
- Send API grava `WHATSAPP_MESSAGE_SENT` uma vez.  
- Webhook SENT (PENDING→SENT) só audita se Message foi criada por outro caminho.  
- DELIVERED/READ/FAILED sempre auditam na primeira transição efetiva.

---

## 7. Estratégia de Echo Protection (D8)

### 7.1 Problema

Após `send`, Evolution frequentemente emite `messages.upsert` com `fromMe=true` e o **mesmo** `key.id` da mensagem enviada. Sem proteção:

1. Message OUTBOUND (correto)  
2. Message INBOUND duplicada (eco) + possível Lead/Conversation side-effects  

### 7.2 Alternativas

#### Opção E1 — Só `fromMe` ignore (Fase 2 atual)

| Prós | Contras |
|---|---|
| Simples | Se Evolution não mandar fromMe, vazamento |
| Já implementado | Não atualiza status via echo |

#### Opção E2 — Idempotência por `external_message_id` (D4)

| Prós | Contras |
|---|---|
| Eco com mesmo id → duplicate 200 | Requer OUTBOUND já persistido com id |
| Zero INBOUND duplicado | Race se echo chega antes do UPDATE SENT |

#### Opção E3 — Persist PENDING + set id atômico + fromMe + id match (**combinada**)

| Prós | Contras |
|---|---|
| Defesa em profundidade | Um pouco mais de código |
| Race reduzida (id gravado logo no retorno Evolution, antes de responder HTTP) | — |
| fromMe cobre eco sem id casado ainda | — |

#### Opção E4 — Lista “recent outbound fingerprints” (phone+body+window)

| Prós | Contras |
|---|---|
| Ajuda se ids divergirem | Frágil; falsos positivos |
| — | Não recomendado como primário |

### 7.3 Escolha recomendada: **E3 (combinada)** — P3-E1

Pipeline inbound (já Fase 2) permanece; Fase 3 reforça:

```text
1. Send: PENDING → Evolution → UPDATE externalMessageId + SENT (rápido)
2. Inbound webhook:
   a. fromMe === true → IGNORED (ECHO_FROM_ME)  [já existe]
   b. EXISTS Message(companyId, externalMessageId) → DUPLICATE / IGNORED
   c. Nunca criar Lead/Conversation em echo
3. Opcional: se fromMe && Message OUTBOUND PENDING sem id ainda
   → atualizar OUTBOUND com id do echo (heal race) em vez de INBOUND
```

**Heal race (recomendado P3-E2: sim):**  
Se `fromMe` e não há Message com esse id, procurar OUTBOUND recente (`PENDING`/`SENT`, mesmo phone/conversation, janela ≤ 2 min, body match). Se achar → set `externalMessageId` + `SENT`; **não** criar INBOUND.

### 7.4 Regras finais Echo

- Echo **não** cria INBOUND  
- Echo **não** atualiza `lastInboundAt`  
- Echo **pode** completar `externalMessageId` / status SENT (heal)  
- Echo **não** substitui webhooks de DELIVERED/READ (acks separados)

---

## 8. Multi-tenancy — regras completas

| Regra | Detalhe |
|---|---|
| Send tenant | **Somente** `JWT.cid` |
| Body `companyId` | **Ignorado / rejeitado** (não aceitar no DTO) |
| Lead | `WHERE id AND companyId = cid AND deletedAt null` |
| Conversation | idem + `lead.companyId = cid` |
| Instance | `findFirst({ companyId: cid, deletedAt: null })` — 1:1 (D1) |
| Phone destino | **Somente** `Lead.phone` da company (digits) — nunca phone livre no body |
| Webhook ack | Tenant via `instanceKey` → `instance.companyId` (igual Fase 2) |
| Cross-tenant conversationId | 404 (não 403) para não vazar existência |
| Agent de company A | Não alcança leads de B (JWT.cid) |
| Evolution instance name | Só a instance da company; sem override |

### 8.1 Gate CONNECTED

```text
if (!instance || instance.status !== CONNECTED)
  → 409 Conflict { message: 'WhatsApp instance not CONNECTED' }
```

Inbound (Fase 2) continua aceitando ≠ CONNECTED (P2-S1).  
Outbound **exige** CONNECTED.

---

## 9. Auditoria

| Action | Quando | actorType | targetType |
|---|---|---|---|
| `WHATSAPP_MESSAGE_SENT` | Message → SENT (send API) | USER (`JWT.sub`) | MESSAGE |
| `WHATSAPP_MESSAGE_DELIVERED` | → DELIVERED (webhook) | SYSTEM | MESSAGE |
| `WHATSAPP_MESSAGE_READ` | → READ (webhook) | SYSTEM | MESSAGE |
| `WHATSAPP_MESSAGE_FAILED` | → FAILED (send ou webhook) | USER ou SYSTEM | MESSAGE |

Snapshots mínimos: `id`, `conversationId`, `leadId`, `status`, `externalMessageId`, `body` truncado (≤2000).

Mesma transação do update de status quando possível.

**Não** auditar no-op de ack duplicado.

---

## 10. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| Envio com instance desconectada | Alta | Gate CONNECTED → 409 |
| Echo vira INBOUND | Alta | E3: fromMe + external id + heal race |
| Cross-tenant send | Crítica | JWT.cid em todas as queries |
| Phone livre no body | Alta | DTO sem phone; só Lead.phone |
| Evolution timeout após envio real | Alta | PENDING→? ; reconciliar via webhook/echo id |
| Duplicar send (double-click) | Média | Idempotency-Key futuro; UI debounce; não reusar Message FAILED |
| Status webhook fora de ordem | Média | Transições monotônicas |
| Vazamento de conteúdo em audit | Baixa | Truncate body |
| Rate limit WhatsApp/Evolution | Média | 429 → FAILED; retry manual; fila futura |
| FollowUp execute ainda local | Baixa | Fase 4 troca implementação; Fase 3 só endpoint /send |
| Leitura de receipts desativada no WA | Baixa | Ficar em DELIVERED; não forçar READ |
| CLOSED conversation send | Média | P3-C2: rejeitar ou reabrir — ver decisões |

---

## 11. Impactos em módulos existentes

| Módulo | Impacto Fase 3 |
|---|---|
| WhatsApp Fase 1/2 | Estender webhook + EvolutionClient.sendText + events ack |
| Conversations API | Continua podendo criar Message local OUTBOUND; **send WhatsApp** só via `/whatsapp/send` |
| FollowUp execute | **Sem mudança obrigatória** nesta fase (ainda persist-only); ponte documentada |
| Leads | `lastOutboundAt` / `lastContactAt` |
| Dashboard | Contadores outbound sobem automaticamente |
| Inbound parser | Reforço heal race (P3-E2) |

---

## 12. Schema / migrations planejadas (após aprovação)

1. **Nenhuma tabela nova obrigatória** se status couber em `Message.status` (string).  
2. Opcional: CHECK/documentação dos valores outbound.  
3. Opcional futuro: `MessageSync` (adiado — P3-S1).  
4. Evolution webhook events: adicionar `MESSAGES_UPDATE` (ou equivalente).  

Índice já existente: `(company_id, external_message_id)` partial unique — essencial para echo/ack.

---

## 13. Critérios de aceite (implementação futura)

- [ ] `POST /api/whatsapp/send` autenticado com tenant `JWT.cid`  
- [ ] Valida Lead + Conversation da company  
- [ ] Recusa send se instance ≠ `CONNECTED` (409)  
- [ ] Chama Evolution `sendText`  
- [ ] Cria Message `OUTBOUND` com `externalMessageId`  
- [ ] Status inicial PENDING → SENT (ou FAILED)  
- [ ] Atualiza `Conversation.lastMessageAt`  
- [ ] Webhooks atualizam DELIVERED / READ / FAILED de forma monotônica  
- [ ] Echo `fromMe` não cria INBOUND; id match / heal race  
- [ ] Audits `WHATSAPP_MESSAGE_SENT|DELIVERED|READ|FAILED`  
- [ ] Sem phone/companyId no body  
- [ ] Sem IA / FollowUp auto / filas / mídia  
- [ ] `docs/whatsapp-phase3-review.md` após implementação  
- [ ] Testes: send ok, not connected, cross-tenant 404, echo protection, ack transitions  

---

## 14. Decisões pedindo aprovação explícita

| ID | Pergunta | Recomendação |
|---|---|---|
| **P3-R1** | AGENT pode `POST /send`? | **Sim** |
| **P3-C1** | Contrato: `conversationId` e/ou `leadId`? | Ambos; preferir conversationId |
| **P3-C2** | Send em Conversation CLOSED? | **400** — exigir OPEN/IDLE ou criar nova via leadId |
| **P3-O1** | Persist PENDING antes do Evolution? | **Sim (Opção A)** |
| **P3-E1** | Echo protection E3 combinada? | **Sim** |
| **P3-E2** | Heal race fromMe → preencher external id OUTBOUND? | **Sim** |
| **P3-S1** | Criar tabela MessageSync nesta fase? | **Não** |
| **P3-T1** | Atualizar `Lead.lastOutboundAt` / `lastContactAt`? | **Sim** |
| **P3-A1** | Evitar audit SENT duplicado (API vs webhook)? | **Sim** |
| **P3-F1** | Alterar FollowUp execute nesta fase? | **Não** (Fase 4) |

---

## 15. Relação com roadmap

| Fase | Estado |
|---|---|
| 1 Conexão | Feita |
| 2 Inbound | Feita |
| **3 Outbound** | **Este design** |
| 4 FollowUp → WhatsApp send | Usa `WhatsappSendService` internamente |
| 5 IA assistiva | Sugere → humano aprova → chama send |

---

## 16. Próximo passo

**Aguardar aprovação** deste design (e P3-R1…P3-F1).  
Somente após aprovação explícita → implementar Outbound Engine.  
**Nenhum código nesta etapa.**

---

*Fim do design WhatsApp Fase 3.*
