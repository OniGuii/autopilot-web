# WhatsApp Phase 3 Review — Outbound Engine

**Status:** Implementado  
**Branch:** `cursor/whatsapp-phase3-implementation-dd93`  
**Base:** `whatsapp-phase3-design.md` + decisões P3-* congeladas  
**Pré-requisitos:** Fase 1 (conexão) + Fase 2 (inbound)

---

## 1. Escopo entregue

| Incluído | Excluído |
|---|---|
| `POST /api/whatsapp/send` | FollowUp → WhatsApp (P3-F1) |
| Message PENDING→SENT/FAILED | MessageSync (P3-S1) |
| Webhooks delivered/read/failed | IA / n8n / BullMQ |
| Echo Protection E3 + heal race | Mídia |
| `failedAt` / `errorMessage` | Deploy produção |
| `Lead.lastOutboundAt` update | Auto-fail PENDING>5min (só doc P3-D3) |

---

## 2. Decisões aplicadas

| ID | Implementação |
|---|---|
| **P3-R1** | Roles OWNER \| ADMIN \| AGENT |
| **P3-C1** | `leadId` + `conversationId` obrigatórios |
| **P3-C2** | CLOSED/ARCHIVED → 400 |
| **P3-O1** | Create PENDING antes do Evolution |
| **P3-E1** | fromMe + externalMessageId |
| **P3-E2** | Heal race (janela 2 min) |
| **P3-S1** | Sem MessageSync |
| **P3-T1** | `lastOutboundAt` (+ `lastContactAt`) |
| **P3-F1** | FollowUp intocado |
| **P3-D1** | FAILED nunca apagado |
| **P3-D2** | Status monotônico |
| **P3-D3** | `PENDING_STALE_MINUTES = 5` documentado |

---

## 3. Migrations

### `20260803170000_whatsapp_outbound_fields`

```sql
ALTER TABLE messages
  ADD COLUMN failed_at TIMESTAMPTZ(6),
  ADD COLUMN error_message VARCHAR(1000);

CREATE INDEX messages_company_id_direction_status_idx
  ON messages (company_id, direction, status);
```

Campos já existentes reutilizados: `status` (String), `sent_at`, `delivered_at`, `read_at`, `Lead.last_outbound_at`.

---

## 4. Endpoint

```http
POST /api/whatsapp/send
Authorization: Bearer <access>
```

```json
{
  "leadId": "uuid",
  "conversationId": "uuid",
  "body": "texto"
}
```

Tenant: **somente `JWT.cid`**. Sem `companyId`/`phone` no body.

Gate: WhatsAppInstance da company com `status === CONNECTED` (senão 409).

---

## 5. Fluxo outbound

```text
JWT.cid
  → validar Lead + Conversation (mesmo lead, OPEN/IDLE)
  → instance CONNECTED
  → CREATE Message PENDING
  → Evolution sendText (stub se EVOLUTION_API_URL vazio)
  → SUCCESS: SENT + externalMessageId + sentAt
       + Conversation.lastMessageAt
       + Lead.lastOutboundAt / lastContactAt
       + Audit WHATSAPP_MESSAGE_SENT
  → FAILURE: FAILED + failedAt + errorMessage
       + Audit WHATSAPP_MESSAGE_FAILED
       + HTTP 502 (row mantida — P3-D1)
```

---

## 6. Status machine (P3-D2)

```text
PENDING → SENT
PENDING → FAILED
SENT → DELIVERED
DELIVERED → READ
```

- Regressões / saltos inválidos → **ignorados** + audit `WHATSAPP_MESSAGE_STATUS_REGRESSION`  
- INBOUND permanece `RECEIVED`  
- **P3-D3:** PENDING > 5 minutos = alerta operacional (sem auto-transição nesta fase)

---

## 7. Webhook de status

Eventos: `messages.update` / `message.sent|delivered|read|failed` (parser tolerante).

```text
instanceKey → companyId
  → parseDeliveryUpdate
  → find OUTBOUND by externalMessageId
  → transition monotônica + audits DELIVERED|READ|FAILED|SENT
```

Evolution `setWebhook` inclui `MESSAGES_UPDATE`.

---

## 8. Echo Protection

1. `fromMe` → nunca cria INBOUND (Fase 2)  
2. `externalMessageId` já existente → DUPLICATE  
3. Heal race (P3-E2): OUTBOUND PENDING/SENT recente (≤2 min, mesmo phone/body, sem id) recebe o id do echo → SENT  

---

## 9. Multi-tenancy

| Superfície | Tenant |
|---|---|
| `/send` | `JWT.cid` |
| webhook ack/echo | `instanceKey` → `WhatsAppInstance.companyId` |
| payload.companyId | Ignorado |

Lead/Conversation sempre filtrados por `companyId`. Cross-tenant → 404.

---

## 10. Auditoria

| Action | Origem |
|---|---|
| `WHATSAPP_MESSAGE_SENT` | Send API / heal PENDING→SENT |
| `WHATSAPP_MESSAGE_DELIVERED` | Webhook |
| `WHATSAPP_MESSAGE_READ` | Webhook |
| `WHATSAPP_MESSAGE_FAILED` | Send API / webhook |
| `WHATSAPP_MESSAGE_STATUS_REGRESSION` | Webhook transição inválida |

---

## 11. Arquivos principais

| Arquivo | Papel |
|---|---|
| `outbound/whatsapp-send.service.ts` | Send engine |
| `outbound/whatsapp-delivery.service.ts` | Acks + echo heal |
| `outbound/message-status.ts` | Máquina de estados |
| `outbound/parse-delivery-update.ts` | Parser acks |
| `outbound/parse-echo-candidate.ts` | Parser echo |
| `dto/send-whatsapp-message.dto.ts` | DTO |
| `evolution.client.ts` | `sendText` + MESSAGES_UPDATE |
| `docs/whatsapp-phase3-review.md` | Este review |

---

## 12. Testes executados

```bash
cd apps/api
npx prisma migrate deploy   # applied 20260803170000_whatsapp_outbound_fields
npx prisma generate
npm test -- --testPathPatterns='whatsapp'
npm run build
```

Resultado: **7 suites / 36 tests passed**; `nest build` OK.

---

## 13. Riscos remanescentes

| Risco | Mitigação atual / residual |
|---|---|
| Timeout Evolution após envio real | PENDING fica; heal echo / ack futuros |
| PENDING órfão > 5 min | Documentado (P3-D3); job futuro |
| Variantes de payload Evolution | Parsers tolerantes + IGNORED |
| Double-click send | Duas Messages (Idempotency-Key futuro) |
| FollowUp ainda local | Fase 4 |

---

## 14. Critérios de aceite

- [x] `POST /api/whatsapp/send`  
- [x] Tenant JWT.cid  
- [x] CONNECTED gate  
- [x] PENDING → SENT/FAILED  
- [x] externalMessageId + sentAt  
- [x] lastMessageAt + lastOutboundAt  
- [x] Webhooks delivery  
- [x] Status monotônico + audit regressão  
- [x] Echo protection + heal  
- [x] Sem MessageSync / FollowUp / filas  
- [x] Review doc + testes  

---

*Fim do review WhatsApp Fase 3.*
