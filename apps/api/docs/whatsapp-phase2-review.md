# WhatsApp Phase 2 Review — Inbound Engine

**Status:** Implementado  
**Branch:** `cursor/whatsapp-phase2-implementation-dd93`  
**Base:** `whatsapp-phase2-design.md` + decisões P2-L1…P2-T1  
**Pré-requisito:** Fase 1 (`whatsapp-phase1-review.md`)

---

## 1. Escopo entregue

| Incluído | Excluído |
|---|---|
| Tabela `webhook_events` + model Prisma | Outbound / send-message |
| Webhook inbound `messages.upsert` | IA / n8n / BullMQ |
| Tenant via `instanceKey` only | FollowUp automático |
| Idempotência `external_message_id` | Dashboard |
| Auto Lead `CONTACTED` + promote NEW | Filas |
| Conversation OPEN/IDLE reuse (D2) | Deploy produção |
| Audits SYSTEM na mesma tx | |

---

## 2. Decisões congeladas aplicadas

| ID | Implementação |
|---|---|
| **P2-L1** | Auto-Lead `status = CONTACTED` |
| **P2-L2** | Lead `NEW` → `CONTACTED` no inbound |
| **P2-C1** | Reutilizar `OPEN`/`IDLE`; criar se só `CLOSED`/`ARCHIVED` |
| **P2-W1** | Tabela `webhook_events` + enum `WebhookEventStatus` |
| **P2-S1** | Inbound aceito mesmo se instance ≠ `CONNECTED` |
| **P2-T1** | Atualiza `Lead.lastInboundAt` e `Lead.lastContactAt` |

D9 no `whatsapp-design.md` atualizado para `CONTACTED` no caminho inbound.

---

## 3. Arquitetura

```text
POST /api/whatsapp/webhook/:instanceKey
  X-Webhook-Secret

WhatsappController
  → WhatsappService.handleWebhook
       1. resolve WhatsAppInstance by instanceKey
       2. argon2.verify(secret)
       3. companyId := instance.companyId  (ignore payload.companyId)
       4. register WebhookEvent (RECEIVED)
       5a. connection.* → Fase 1 status flow
       5b. messages.upsert → parse → WhatsappInboundService.processInboundMessage
       6. finalize WebhookEvent (PROCESSED|IGNORED|DUPLICATE|FAILED)

WhatsappInboundService.processInboundMessage(companyId, dto, instance)
  → $transaction:
       Lead resolve/create
       Conversation resolve/create (D2)
       Message INBOUND
       Conversation.lastMessageAt
       Lead.lastInboundAt / lastContactAt (+ promote NEW)
       Audits
```

Processamento **síncrono** (sem BullMQ). Handler extraível para fila futura (D3).

---

## 4. Migrations / tabelas

### Migration `20260803160000_webhook_events`

- Enum `WebhookEventStatus`: `RECEIVED | PROCESSED | FAILED | IGNORED | DUPLICATE`
- Tabela `webhook_events`
- Indexes: `(company_id, received_at)`, `(company_id, status)`, `(instance_id, received_at)`, `(company_id, external_event_id)`
- Partial unique: `uq_webhook_events_company_external_active`  
  `(company_id, external_event_id) WHERE external_event_id IS NOT NULL AND deleted_at IS NULL`

### Já existente (Fase 0/1 — reutilizado)

- `uq_messages_company_external_active` — idempotência de mensagem
- `uq_leads_company_phone_active`
- `uq_conversations_company_channel_external_active`

---

## 5. Fluxo inbound (resumo)

1. Auth webhook (secret + instanceKey)  
2. Persist `WebhookEvent`  
3. Parse Evolution (`fromMe` / grupo / non-text → IGNORED 200)  
4. Se `Message.externalMessageId` existe → DUPLICATE 200 (sem recriar)  
5. Tx: Lead → Conversation → Message → timestamps → audits  
6. HTTP 200 `{ ok, messageId, leadId, conversationId }`

---

## 6. Auditoria

| Action | Quando | actorType |
|---|---|---|
| `WHATSAPP_MESSAGE_RECEIVED` | Message criada | SYSTEM |
| `LEAD_AUTO_CREATED` | Lead auto-criado | SYSTEM |
| `CONVERSATION_AUTO_CREATED` | Conversation auto-criada | SYSTEM |

Mesma `$transaction` da mutação de negócio. Duplicates/ignored **não** geram audit de negócio.

---

## 7. Idempotência

| Camada | Chave | Comportamento |
|---|---|---|
| WebhookEvent | `external_event_id` (se Evolution enviar) | P2002 → 200 `duplicate` |
| Message | `external_message_id` | Early find + P2002 race → 200 `duplicate`, evento `DUPLICATE` |

---

## 8. Multi-tenant

- `companyId` **somente** de `WhatsAppInstance` resolvida pelo path  
- Payload `companyId` / `tenantId` **ignorados**  
- Soft-deleted instance → 404  
- Defense-in-depth: `processInboundMessage` rejeita mismatch instance.companyId  

---

## 9. Evolution

`EvolutionClient.setWebhook` agora registra:

```text
CONNECTION_UPDATE
MESSAGES_UPSERT
```

Stub mode (`EVOLUTION_API_URL` vazio) inalterado — testes usam webhook direto.

---

## 10. Arquivos principais

| Arquivo | Papel |
|---|---|
| `prisma/migrations/20260803160000_webhook_events/` | Migration |
| `prisma/schema.prisma` | `WebhookEvent` + enum |
| `src/modules/whatsapp/whatsapp.service.ts` | Orquestra webhook |
| `src/modules/whatsapp/inbound/whatsapp-inbound.service.ts` | Domínio inbound |
| `src/modules/whatsapp/inbound/parse-inbound-message.ts` | Parser Evolution |
| `src/modules/whatsapp/evolution.client.ts` | Eventos webhook |
| `docs/whatsapp-phase2-review.md` | Este review |

---

## 11. Cenários de teste

| Cenário | Resultado esperado |
|---|---|
| Upsert texto válido | Lead/Conv/Msg + audits + 200 |
| Mesmo `external_message_id` | 200 duplicate, sem side-effects |
| `fromMe` | ignored ECHO |
| Grupo `@g.us` | ignored GROUP |
| Secret inválido | 403 |
| instance desconhecida | 404 |
| Instance DISCONNECTED | ainda processa inbound |
| payload.companyId falso | ignorado; usa instance.companyId |
| Lead NEW existente | promove CONTACTED |
| Conversation OPEN | reutiliza |

---

## 12. Riscos residuais

| Risco | Mitigação atual |
|---|---|
| Payload Evolution variante | Parser tolerante + IGNORED 200 |
| Race paralelismo | Unique partial + catch P2002 |
| Thread id em conversa CLOSED | Nova conversa com `externalThreadId=null` se ocupado |
| Volume de `webhook_events` | Truncate payload >50KB; retenção futura |
| Retry de FAILED com mesmo event id | Reprocess controlado = fase futura |

---

## 13. Testes executados

```bash
cd apps/api
npx prisma migrate deploy   # applied 20260803160000_webhook_events
npx prisma generate
npm test -- --testPathPatterns='whatsapp|parse-inbound'
npm run build
```

Resultado: **3 suites / 20 tests passed**; `nest build` OK.

---

## 14. Critérios de aceite

- [x] Webhook inbound com tenant via `instanceKey`  
- [x] Sem `companyId` do payload  
- [x] Idempotência `external_message_id` (+ event id quando houver)  
- [x] Auto Lead CONTACTED + promote NEW  
- [x] Conversation D2  
- [x] Message INBOUND + `lastMessageAt` na mesma tx  
- [x] Audits obrigatórias  
- [x] Echo/grupos/non-text ignored  
- [x] Sem outbound / IA / FollowUp / filas  
- [x] `docs/whatsapp-phase2-review.md`  
- [x] Tabela `WebhookEvent`  

---

*Fim do review WhatsApp Fase 2.*
