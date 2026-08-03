# WhatsApp Phase 1 Review — Conexão Evolution

**Status:** Implementado  
**Branch:** `cursor/whatsapp-phase1-implementation-dd93`  
**Base:** `whatsapp-design.md` (D1–D10) + `whatsapp-implementation-plan.md` + **D11–D18**

---

## 1. Escopo entregue

| Incluído | Excluído (fases futuras) |
|---|---|
| `WhatsAppInstance` + migration | Inbound messages |
| connect / status / disconnect | Outbound send |
| webhook conexão + `X-Webhook-Secret` | Auto lead / conversation |
| Auditoria D14 | IA / n8n |
| Stub Evolution (sem URL) | `WebhookEvent` table (D5 → Fase 2) |

---

## 2. Decisões D11–D18 aplicadas

| ID | Implementação |
|---|---|
| D11 | `instance_key` = UUID |
| D12 | 64 bytes → base64url; **argon2** em `webhook_secret_hash` |
| D13 | Enum `QR_PENDING\|CONNECTING\|CONNECTED\|DISCONNECTED\|ERROR` |
| D14 | `WHATSAPP_CONNECT`, `WHATSAPP_CONNECTED`, `WHATSAPP_DISCONNECT`, `WHATSAPP_STATUS_CHANGE` |
| D15 | Connect se já `CONNECTED` → retorna instância atual |
| D16 | Disconnect não apaga; `status=DISCONNECTED`; `connected_at=null` |
| D17 | Webhook ignora eventos que não são de conexão |
| D18 | Status: `status`, `phoneNumber`, `instanceName`, `connectedAt` (+ `instanceKey`) |

---

## 3. Arquitetura

```text
POST /api/whatsapp/connect     (OWNER/ADMIN)
GET  /api/whatsapp/status      (OWNER/ADMIN/AGENT)
POST /api/whatsapp/disconnect  (OWNER/ADMIN)
POST /api/whatsapp/webhook/:instanceKey  (público + X-Webhook-Secret)

WhatsappController
  → WhatsappService
       → Prisma WhatsAppInstance
       → EvolutionClient (real ou stub)
       → AuditService
```

Stub: `EVOLUTION_API_URL` vazio → QR `stub-qr:{instanceKey}`.

---

## 4. Schema

Tabela `whatsapp_instances` + enum `WhatsAppConnectionStatus`.  
Partial unique: `uq_whatsapp_instances_company_active` (1 ativa / company).  
Migration: `20260803140000_whatsapp_instances`.

---

## 5. Exemplos

### Connect
```http
POST /api/whatsapp/connect
Authorization: Bearer <access>
```
```json
{
  "companyId": "...",
  "status": "QR_PENDING",
  "phoneNumber": null,
  "instanceName": "ap...",
  "instanceKey": "<uuid>",
  "connectedAt": null,
  "qrCode": "stub-qr:..."
}
```

### Webhook connected
```http
POST /api/whatsapp/webhook/<instanceKey>
X-Webhook-Secret: <plain-secret>
```
```json
{ "event": "connection.update", "data": { "state": "open", "wuid": "5511999990000@s.whatsapp.net" } }
```

### Status (D18)
```json
{
  "status": "CONNECTED",
  "phoneNumber": "5511999990000",
  "instanceName": "ap...",
  "connectedAt": "..."
}
```

---

## 6. Riscos remanescentes

| Risco | Nota |
|---|---|
| Evolution API shape varia por versão | Adapter isolado; stub para dev |
| Secret só na Evolution + hash local | Plain não fica no DB; reconnect regenera secret |
| Webhook URL pública | `API_PUBLIC_URL` + tunnel em dev |
| Sem WebhookEvent ainda | Replay limitado até Fase 2 |

---

## 7. Critérios de aceite

- [x] Migration + schema  
- [x] Endpoints connect/status/disconnect/webhook  
- [x] D11–D18  
- [x] Auditoria  
- [x] Sem processamento de mensagens  
- [x] `docs/whatsapp-phase1-review.md`  
- [x] Testes locais  
