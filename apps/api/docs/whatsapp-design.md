# WhatsApp Design — Evolution API Integration

**Status:** Aprovado — decisões D1–D10 **congeladas**  
**Fase:** 7 — WhatsApp Integration (Design)  
**Pré-requisitos:** Auth, Leads, Conversations, Messages, FollowUps, Dashboard, Audit  
**Stack alvo:** NestJS + Evolution API (WhatsApp)  
**Plano Fase 1:** `whatsapp-implementation-plan.md` (somente planejamento — sem código nesta etapa)

Referências atuais do domínio:
- `Conversation.externalThreadId`, `Message.externalMessageId` (já no schema)
- Partial unique: `(company_id, channel, external_thread_id)` ativo
- Índice: `(company_id, external_message_id)`
- Phone único por company (D6) + normalização digits-only (Leads)
- FollowUp execute hoje: Message OUTBOUND **local** (sem envio)

### Decisões congeladas (D1–D10)

| ID | Decisão |
|---|---|
| **D1** | 1 Company = 1 WhatsAppInstance (MVP) |
| **D2** | Conversation: reutilizar `OPEN`/`IDLE`; criar nova se `CLOSED`/`ARCHIVED` |
| **D3** | Arquitetura: Webhook → Queue → Worker (impl. inicial pode ser síncrona) |
| **D4** | Idempotência: `external_message_id`; partial unique futura `(company_id, external_message_id) WHERE deleted_at IS NULL` |
| **D5** | Persistência de `WebhookEvent` obrigatória no roadmap |
| **D6** | FollowUp futuro: `APPROVED → SCHEDULED → EXECUTING → EXECUTED/FAILED` |
| **D7** | Webhook: `POST /api/whatsapp/webhook/:instanceKey` + header `X-Webhook-Secret` |
| **D8** | Echo Messages Strategy (seção dedicada) |
| **D9** | Auto Lead: `name=phone`, `phone=phone`, `status=NEW`, `ownerId=null`, `score=0` |
| **D10** | IA assistiva: sugere → humano aprova → envia |

---

## 1. Objetivo

Definir a arquitetura técnica completa para:

1. Conectar uma **Company** a uma **instância Evolution**
2. Receber webhooks inbound com segurança multi-tenant
3. Enviar mensagens outbound via Evolution
4. Garantir **idempotência** e isolamento de tenant
5. Preparar integração futura com **FollowUps** e **IA**

---

## 2. Modelo conceitual (futuro — apenas documentação)

Nenhuma destas entidades é criada nesta etapa. São conceitos para fases posteriores.

### 2.1 `WhatsAppInstance`

Representa o vínculo Company ↔ Evolution Instance.

| Campo conceitual | Descrição |
|---|---|
| `id` | UUID interno |
| `companyId` | Tenant dono (fonte de verdade) |
| `evolutionInstanceName` | Nome da instância na Evolution |
| `evolutionInstanceId` | Id externo se disponível |
| `status` | ver §7 (CONNECTED / …) |
| `phoneNumber` | Número conectado (digits), quando conhecido |
| `webhookSecret` | Segredo para validar webhooks (por company/instance) |
| `lastConnectedAt` / `lastError` | Observabilidade |
| `createdAt` / `updatedAt` / `deletedAt` | padrão AutoPilot |

**Cardinalidade MVP (D1):** **1 Company → 1 WhatsAppInstance ativa**  
(Multi-número / multi-instância = V2.)

### 2.2 `WebhookEvent`

Log/append-only de eventos brutos recebidos da Evolution (auditoria técnica + reprocessamento).

| Campo conceitual | Descrição |
|---|---|
| `id` | UUID |
| `companyId` | Resolvido via instance mapping |
| `instanceId` | FK conceitual → WhatsAppInstance |
| `providerEventId` | Id do evento Evolution (se houver) |
| `eventType` | `MESSAGES_UPSERT`, `CONNECTION_UPDATE`, … |
| `payload` | JSON bruto |
| `status` | `RECEIVED` \| `PROCESSED` \| `FAILED` \| `IGNORED` |
| `error` | Mensagem de falha |
| `receivedAt` / `processedAt` | Timestamps |

Uso: idempotência de webhook, debug, replay manual futuro.

### 2.3 `MessageSync`

Estado de sincronização Message AutoPilot ↔ Evolution (envio/ack).

| Campo conceitual | Descrição |
|---|---|
| `id` | UUID |
| `companyId` | Tenant |
| `messageId` | FK → Message |
| `externalMessageId` | Id Evolution/WhatsApp |
| `direction` | INBOUND / OUTBOUND |
| `syncStatus` | `PENDING` \| `SENT` \| `DELIVERED` \| `READ` \| `FAILED` |
| `attempts` | Retries de envio |
| `lastError` | Último erro Evolution |
| `providerRaw` | Metadados opcionais |

**Nota:** Parte disso pode viver em `Message.status` + `externalMessageId` no curto prazo; `MessageSync` é o modelo alvo se o ciclo de vida de entrega ficar rico demais para a tabela `messages`.

### 2.4 Mapeamento com schema atual (já existente)

| Conceito | Campo atual |
|---|---|
| Thread WhatsApp | `conversations.external_thread_id` |
| Msg provider id | `messages.external_message_id` |
| Canal | `conversations.channel = WHATSAPP` |
| Telefone lead | `leads.phone` (digits-only) |

---

## 3. Arquitetura proposta

```text
                    ┌─────────────────────┐
                    │   Evolution API     │
                    │  (WhatsApp engine)  │
                    └─────────┬───────────┘
                              │
              webhook inbound │  outbound send
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ AutoPilot API (NestJS)                                       │
│                                                              │
│  POST /api/whatsapp/webhook  (público + assinatura/secret)   │
│           │                                                  │
│           ▼                                                  │
│  WhatsappWebhookService                                      │
│    1. Validar assinatura / secret                            │
│    2. Resolver WhatsAppInstance → companyId                  │
│    3. Idempotência (WebhookEvent / externalMessageId)        │
│    4. Upsert Lead / Conversation / Message INBOUND           │
│    5. Audit                                                  │
│                                                              │
│  WhatsappSendService (interno / autenticado)                 │
│    1. companyId = JWT.cid (ou job interno com companyId)     │
│    2. Resolver instance CONNECTED da company                 │
│    3. POST Evolution send                                    │
│    4. Persistir Message OUTBOUND + externalMessageId         │
│    5. Atualizar Conversation.lastMessageAt                   │
│                                                              │
│  Domínio existente: Lead · Conversation · Message · FollowUp │
└──────────────────────────────────────────────────────────────┘
```

Princípios:
- **Evolution nunca escolhe o tenant** — o mapping Instance→Company é server-side.
- Cliente autenticado **nunca** envia `companyId` confiável.
- Webhook é a única superfície pública WhatsApp (além de health).

---

## 4. Conectar Company ↔ Evolution Instance

### 4.1 Modelo de binding

```text
Company (tenant)
  └── WhatsAppInstance (1 ativa)
        ├── evolutionInstanceName
        ├── webhookSecret
        └── status
```

### 4.2 Fluxo de conexão (conceitual)

```text
OWNER/ADMIN autenticado (JWT.cid)
  → POST /api/whatsapp/connect
  → AutoPilot cria/ativa WhatsAppInstance(companyId=cid)
  → Chama Evolution: create/connect instance
  → Persiste status = QR_PENDING | CONNECTING
  → Retorna QR / pairing info ao client
  → Webhooks CONNECTION_UPDATE atualizam status → CONNECTED
```

### 4.3 Configuração Evolution

Env já previstos (`.env.example`):
- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE` (dev single-tenant; prod usa instance por company)

**Produção multi-tenant:** `EVOLUTION_INSTANCE` global **não** basta.  
Cada Company tem `evolutionInstanceName` próprio no registro `WhatsAppInstance`.

### 4.4 Descoberta de Company no webhook

Ordem de resolução (obrigatória):

1. Extrair `instance` / `instanceName` do payload Evolution  
2. Lookup `WhatsAppInstance` por `evolutionInstanceName` (`deletedAt null`)  
3. `companyId = instance.companyId`  
4. Se não achar → **404/ignore** (log + `WebhookEvent FAILED/IGNORED`) — **nunca** fallback para “default company”

**Proibido:**
- Aceitar `companyId` no body do webhook
- Inferir tenant pelo número do destinatário sem instance mapping
- Usar JWT do usuário no webhook (webhook é machine-to-machine)

---

## 5. Fluxo inbound (mensagem recebida)

```text
Webhook Evolution (MESSAGES_UPSERT / similar)
        │
        ▼
Validar secret / assinatura
        │
        ▼
Identificar Instance → Company
        │
        ▼
Normalizar telefone remetente (digits-only)
        │
        ▼
Idempotência: external_message_id já existe para company?
   sim → IGNORED (200)
   não ↓
Encontrar Lead (companyId + phone)
   não existe → criar Lead (status NEW, source WHATSAPP, name fallback)
        │
        ▼
Encontrar Conversation (companyId + leadId + channel WHATSAPP [+ externalThreadId])
   não existe → criar Conversation (OPEN, externalThreadId se houver)
        │
        ▼
Criar Message INBOUND
  companyId = company da instance
  conversationId = conversation.id
  direction = INBOUND
  body = texto extraído
  externalMessageId = id provider
  senderType = LEAD
  status = RECEIVED
  sentAt = timestamp provider ou now
        │
        ▼
Atualizar Conversation.lastMessageAt
Atualizar Lead.lastInboundAt / lastContactAt (fase WhatsApp)
        │
        ▼
Audit: MESSAGE_CREATE (+ LEAD_CREATE / CONVERSATION_CREATE se criados)
Registrar WebhookEvent PROCESSED
```

### 5.1 Decisões inbound

| Tópico | Decisão proposta |
|---|---|
| Telefone | Sempre digits-only (igual Leads MVP) |
| Lead sem nome (D9) | `name = phone`, `status = NEW`, `ownerId = null`, `score = 0`, `source = WHATSAPP` |
| Conversation (D2) | Reutilizar se `OPEN` ou `IDLE`; **criar nova** se só existir `CLOSED`/`ARCHIVED` |
| Mídia (imagem/áudio) | MVP texto; mídia → `contentType` + URL em metadata (fase posterior) |
| Grupos | Fora do MVP (ignorar / IGNORED) |
| Echo outbound (D8) | Ver § Echo Messages Strategy |

### 5.2 Direção (já congelada no produto)

- `INBOUND` = cliente → empresa  
- `OUTBOUND` = empresa → cliente  

---

## 6. Fluxo outbound (mensagem enviada)

### 6.1 Envio manual / API futura

```text
Cliente autenticado (JWT.cid)
  → POST /api/whatsapp/send-message { leadId | conversationId, body }
  → Validar Lead/Conversation da company
  → WhatsAppInstance status == CONNECTED
  → Evolution sendText(instance, phone, body)
  → Persistir Message OUTBOUND + externalMessageId
  → Conversation.lastMessageAt = now
  → Audit MESSAGE_CREATE
```

### 6.2 Integração com FollowUp Execute (futuro)

Estado atual (Fase 5): execute cria Message OUTBOUND **sem** Evolution.

Estado alvo (D6):

```text
APPROVED → SCHEDULED → EXECUTING → EXECUTED | FAILED

POST /api/follow-ups/:id/execute
  → status EXECUTING
  → WhatsAppSendService.send(...)
  → Evolution API
  → sucesso: Message OUTBOUND + EXECUTED + audits
  → falha: FAILED + lastError (não marcar EXECUTED)
```

**Decisão de transição:** manter contrato do execute; trocar implementação interna de “persist-only” para “send+persist”.

---

## 12b. Echo Messages Strategy (D8)

WhatsApp/Evolution frequentemente reenviam (ou espelham) mensagens **enviadas pela própria empresa** como eventos inbound (`fromMe=true` / equivalente).

### Problema
Sem tratamento, o mesmo texto vira:
1. Message OUTBOUND (envio AutoPilot)  
2. Message INBOUND duplicada (echo do webhook)

### Estratégia congelada

| Passo | Ação |
|---|---|
| 1 | Extrair `external_message_id` do evento |
| 2 | Se já existe Message com esse id na company → **IGNORED** (idempotência D4) |
| 3 | Se flag `fromMe` / `from_me` / key.fromMe = true **e** não há Message ainda: |
| 3a | Preferir **não criar INBOUND**; opcionalmente upsert OUTBOUND se send local ainda não persistiu id |
| 4 | Se outbound foi enviado pelo AutoPilot milissegundos antes, o id Evolution deve casar no passo 2 |
| 5 | Registrar `WebhookEvent` como `IGNORED` com motivo `ECHO` ou `DUPLICATE_EXTERNAL_ID` |

### Regras
- Nunca criar Lead/Conversation só por echo `fromMe` sem conteúdo de cliente  
- Echo **não** atualiza `lastInboundAt` do Lead  
- Echo **pode** atualizar delivery status futuro via `MessageSync` (Fase 3+)

---

## 12c. Auto Lead Creation (D9)

Quando inbound chega e não existe Lead `(companyId, phone)` ativo:

| Campo | Valor |
|---|---|
| `name` | = `phone` (digits) |
| `phone` | digits-only |
| `status` | `NEW` |
| `ownerId` | `null` |
| `score` | `0` |
| `source` | `WHATSAPP` |
| `companyId` | da instance |

---

## 12d. IA assistiva (D10)

```text
Sugere → Humano aprova → Envia
```

IA nunca envia sozinha. Alinhado a D3 domínio (Follow-Up híbrido).
---

## 7. Estados da conexão (conceitual)

| Status | Significado |
|---|---|
| `QR_PENDING` | Aguardando leitura do QR / pairing |
| `CONNECTING` | Evolution reportou conexão em andamento |
| `CONNECTED` | Pronto para send/receive |
| `DISCONNECTED` | Sessão caiu / logout |
| `ERROR` | Falha de provisionamento ou auth Evolution |

Transições típicas:

```text
(connect) → QR_PENDING → CONNECTING → CONNECTED
CONNECTED → DISCONNECTED (webhook / health)
qualquer → ERROR
DISCONNECTED / ERROR → (reconnect) → QR_PENDING …
```

Regras:
- Outbound só se `CONNECTED`
- Inbound webhook ainda pode chegar durante `CONNECTING` (processar se instance mapeada)
- Dashboard futuro pode expor status (não nesta fase de design)

---

## 8. Idempotência

### 8.1 Mensagens (`external_message_id`) — D4

Estratégia:

1. Extrair id estável do provider (Evolution `key.id` / equivalente)  
2. Antes de insert: `findFirst({ companyId, externalMessageId, deletedAt: null })`  
3. Se existir → **no-op** (HTTP 200)  
4. **Partial unique futura** (schema em fase de implementação inbound):

```sql
CREATE UNIQUE INDEX uq_messages_company_external_active
ON messages (company_id, external_message_id)
WHERE deleted_at IS NULL AND external_message_id IS NOT NULL;
```

Índice não-unique `(company_id, external_message_id)` já existe hoje.

### 8.2 Webhooks duplicados — D5

1. Persistir `WebhookEvent` (obrigatório no roadmap) com chave (`instanceId`/`instanceKey`, `providerEventId`) ou hash  
2. Unique → segundo delivery vira `IGNORED`  
3. Arquitetura alvo (D3): Webhook → Queue → Worker  
4. MVP pode processar **síncrono** no request, mas o contrato mental e o código devem permitir enfileirar sem redesign

### 8.3 Reprocessamento

- Replay controlado a partir de `WebhookEvent` `FAILED`  
- Reprocess deve respeitar a mesma idempotência de `external_message_id`  
- Nunca recriar Lead/Conversation se já existirem

### 8.4 Outbound duplicado (FollowUp double-execute)

- Manter `updateMany` condicional de status (já existe no FollowUp)  
- Fluxo futuro (D6): `APPROVED → SCHEDULED → EXECUTING → EXECUTED|FAILED`  
- Idempotência adicional: client `Idempotency-Key` (futuro)

---

## 9. Multi-tenancy & proteção cross-tenant

| Cenário de risco | Mitigação |
|---|---|
| Webhook sem instance conhecida | Ignorar; não default tenant |
| Payload tenta enviar `companyId` | Ignorar campo; só mapping Instance→Company |
| Lead phone de outra company | Unique é por company — OK criar lead local |
| Conversation de outro tenant no send | Query sempre `companyId=cid` → 404 |
| Instance reatribuída à company errada | Operação admin auditada; unique instanceName global |
| JWT user tenta send para lead de outra company | 404 via cid |
| Webhook secret vazado | Secret por instance; rotação; HTTPS only |
| Echo / race inbound+outbound | Match por `externalMessageId` |

**Regra de ouro:**  
`companyId` **nunca** vem do client/webhook como fonte de verdade.  
Só: `JWT.cid` (rotas autenticadas) ou `WhatsAppInstance.companyId` (webhooks).

---

## 10. Endpoints futuros (somente proposta)

Prefixo: `api`. **Não implementar nesta etapa.**

| Método | Path | Auth | Descrição |
|---|---|---|---|
| `POST` | `/api/whatsapp/connect` | JWT + company + OWNER/ADMIN | Provisiona/conecta instance; retorna QR |
| `GET` | `/api/whatsapp/status` | JWT + company | Status da instance da company |
| `POST` | `/api/whatsapp/disconnect` | JWT + company + OWNER/ADMIN | Logout/disconnect Evolution |
| `POST` | `/api/whatsapp/webhook/:instanceKey` | Público + `X-Webhook-Secret` | Receiver Evolution (D7) |
| `POST` | `/api/whatsapp/send-message` | JWT + company + roles | Envio manual outbound |

### Contratos esboço

**connect**
```json
// response 200
{ "instanceName": "company-slug", "status": "QR_PENDING", "qrCode": "..." }
```

**status**
```json
{ "companyId": "...", "status": "CONNECTED", "phoneNumber": "5511...", "lastConnectedAt": "..." }
```

**webhook** (D7)
```http
POST /api/whatsapp/webhook/:instanceKey
X-Webhook-Secret: <secret>
```
```json
// Evolution payload (variável por versão)
{ "event": "messages.upsert", "instance": "company-slug", "data": { } }
```

Validação:
1. `instanceKey` path = `WhatsAppInstance` lookup key  
2. Header `X-Webhook-Secret` === `instance.webhookSecret`  
3. Se falhar → **401/403** (sem processar)
**send-message**
```json
{ "conversationId": "<uuid>", "body": "Olá!" }
// ou { "leadId": "<uuid>", "body": "Olá!" }
```

---

## 11. Integração futura com FollowUps

| Hoje | Depois (Fase 4 do roadmap WhatsApp) |
|---|---|
| Execute → Message local SENT | Execute → Evolution send → Message + external id |
| Sem `EXECUTING`/`FAILED` na prática | Usar `EXECUTING` / `FAILED` do enum |
| `channel=WHATSAPP` simbólico | Canal real |

Pré-condições para execute “real”:
1. FollowUp com `conversationId`
2. Lead.phone válido
3. WhatsAppInstance `CONNECTED` da company
4. Body = `suggestedBody`

---

## 12. Integração futura com IA

Fora do escopo de implementação imediata. Pontos de encaixe:

```text
Inbound Message persisted
  → Event `message.received`
  → AI Worker (futuro)
  → sugere FollowUp (SUGGESTED) ou draft reply
  → humano aprova (D3)
  → outbound via WhatsApp Service
```

Regras (já no domínio):
- IA **não** envia sozinha no MVP híbrido  
- IA **não** apaga Messages/Leads  
- `actorType` em audit/events distingue `AI` vs `USER`

---

## 13. WhatsApp Risks

| Risco | Severidade | Impacto | Mitigação |
|---|---|---|---|
| Duplicidade de mensagem (webhook retry) | Alta | Conversas poluídas / métricas erradas | `external_message_id` + unique + early return |
| Webhook perdido | Alta | Lead sem resposta registrada | Retries Evolution; DLQ/`WebhookEvent FAILED`; monitoragem |
| Instância desconectada | Alta | Outbound falha; negócio para | Status gate; alertas; reconnect QR |
| Cross-tenant (instance mal mapeada) | Crítica | Vazamento de dados | Mapping estrito; testes; sem default company |
| Rate limits Evolution/WhatsApp | Média | 429 / ban | backoff; fila; limites por company |
| Falhas Evolution (5xx/timeout) | Média | Execute inconsistente | retries idempotentes; status FAILED; não marcar EXECUTED cedo |
| QR expirado | Baixa | Connect incompleto | status ERROR/QR_PENDING; reconnect |
| Phone format mismatch | Média | Lead duplicado lógico | digits-only obrigatório |
| Echo outbound como inbound | Média | Duplicata | dedupe por external id + fromMe |
| Secret webhook fraco | Alta | Injeção de mensagens falsas | secret forte por instance; validação HMAC se disponível |
| Crescimento de payload bruto | Baixa | Storage | retenção/TTL de WebhookEvent |
| Multi-device / split brain | Média | Ordem de msgs | lastMessageAt + ordenação createdAt; sync futura |

---

## 14. Roadmap de implementação (após aprovação do design)

### Fase 1 — Conexão
- Modelo `WhatsAppInstance` (+ migration futura)
- `connect` / `status` / `disconnect`
- Webhooks de `CONNECTION_UPDATE`
- Estados QR_PENDING → CONNECTED

### Fase 2 — Inbound
- `POST /webhook` seguro
- Resolução Company via instance
- Upsert Lead / Conversation / Message INBOUND
- Idempotência `external_message_id`
- `WebhookEvent` log

### Fase 3 — Outbound
- `send-message` autenticado
- Evolution sendText
- Message OUTBOUND + ack/external id
- Gate `CONNECTED`

### Fase 4 — FollowUp Integration
- Execute chama WhatsApp Service
- Estados EXECUTING / FAILED
- Mantém aprovação humana (D3)

### Fase 5 — AI Integration
- Eventos inbound → sugestões
- FollowUp SUGGESTED automático
- Sem auto-send

---

## 15. Decisões — congeladas

Ver tabela **D1–D10** no topo deste documento.  
Não reabrir sem nova aprovação explícita.

---

## 16. Fora de escopo do documento de design (histórico)

- Implementação nesta etapa de design  
- Frontend QR (pertence à implementação Fase 1+)  

---

## 17. Critérios de aceite deste documento

- [x] Modelo conceitual WhatsAppInstance / WebhookEvent / MessageSync  
- [x] Fluxo inbound completo  
- [x] Fluxo outbound + ponte FollowUp  
- [x] Idempotência via `external_message_id`  
- [x] Multi-tenancy e anti cross-tenant  
- [x] Estados de conexão  
- [x] Endpoints futuros documentados  
- [x] Seção WhatsApp Risks  
- [x] Echo Messages Strategy (D8)  
- [x] Roadmap em 5 fases  
- [x] Decisões D1–D10 congeladas  

---

## 18. Próximo passo

Ver **`whatsapp-implementation-plan.md`** — planejamento detalhado da **Fase 1 (Conexão)** sem código.  
Implementação só após aprovação explícita do plano da Fase 1.
