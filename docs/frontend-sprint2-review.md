# Frontend Sprint 2 — Review

**Branch:** `cursor/frontend-sprint2-dd93`  
**App:** `apps/web`  
**Data:** 2026-08-04  
**Escopo:** Conversations · Messages · WhatsApp · FollowUps (approve/reject/execute/reschedule)

---

## 1. Entrega

| Item | Status |
|------|--------|
| Conversations (lista) | OK |
| Conversation Detail | OK |
| Messages Timeline | OK |
| WhatsApp Connection | OK |
| WhatsApp Status | OK |
| FollowUps List | OK |
| FollowUp Detail | OK |
| Approve | OK |
| Reject | OK |
| Execute | OK (UI + chamada API) |
| Reschedule | OK |
| IA / Pipeline / Memberships / Settings | Não implementados |
| Alterações em `apps/api` | Nenhuma |
| Novas APIs | Nenhuma |
| `npm run build` | OK |

---

## 2. Rotas adicionadas

| Rota | Descrição |
|------|-----------|
| `/conversations` | Inbox + criar conversa por `leadId` |
| `/conversations/[conversationId]` | Timeline + composer + criar follow-up |
| `/whatsapp` | Connect / status / disconnect (+ QR) |
| `/follow-ups` | Lista filtrável |
| `/follow-ups/[followUpId]` | Detalhe + ações |

Nav do AppShell atualizada. Middleware cobre as novas rotas.

---

## 3. Endpoints consumidos

### Conversations

| Método | Path | Uso |
|--------|------|-----|
| `GET` | `/api/conversations` | Lista |
| `POST` | `/api/conversations` | Criar |
| `GET` | `/api/conversations/:id` | Detalhe + últimas 50 msgs |
| `POST` | `/api/conversations/:id/messages` | Mensagem CRM (`OUTBOUND`/`INBOUND`) |
| `POST` | `/api/conversations/:id/close` | Fechar |

### WhatsApp

| Método | Path | Uso | Roles |
|--------|------|-----|-------|
| `GET` | `/api/whatsapp/status` | Status (+ QR se `QR_PENDING`) | all |
| `POST` | `/api/whatsapp/connect` | Conectar / QR | OWNER\|ADMIN |
| `POST` | `/api/whatsapp/disconnect` | Desconectar | OWNER\|ADMIN |
| `POST` | `/api/whatsapp/send` | Envio real WA | all |

### Follow-ups

| Método | Path | Uso |
|--------|------|-----|
| `GET` | `/api/follow-ups` | Lista |
| `POST` | `/api/follow-ups` | Criar (`SUGGESTED`) |
| `GET` | `/api/follow-ups/:id` | Detalhe |
| `POST` | `/api/follow-ups/:id/approve` | → `SCHEDULED` |
| `POST` | `/api/follow-ups/:id/reject` | → `REJECTED` (reason) |
| `POST` | `/api/follow-ups/:id/reschedule` | Reagendar |
| `POST` | `/api/follow-ups/:id/execute` | Executar via WA |
| `POST` | `/api/follow-ups/:id/retry` | Retry se `FAILED` |

---

## 4. Fluxo validado

Credenciais: `owner@local.autopilot.dev` / `Demo@12345` (`seed:local`).

| Passo | Resultado |
|-------|-----------|
| Auth + select-company | OK |
| Lead | OK (`GET /api/leads`) |
| Conversation | OK (`POST /api/conversations`) |
| Message | OK (`POST .../messages` OUTBOUND → `SENT`) |
| FollowUp create | OK (`SUGGESTED`) |
| Approve | OK (`SCHEDULED`) |
| Reschedule | OK |
| Reject (segundo FU) | OK (`REJECTED`) |
| Conversation detail messages | OK (timeline com 1+ msgs) |
| WhatsApp connect | OK → `QR_PENDING` + `qrCode` stub |
| WhatsApp status | OK |
| Execute | Chamado; API retornou **409** `WhatsApp instance not CONNECTED` (esperado sem sessão CONNECTED real) |
| Páginas UI `/conversations`, `/follow-ups`, `/whatsapp` | HTTP 200 (com cookies de sessão) |
| Build Next.js 15.5.9 | OK |

Fluxo de produto coberto na UI:

**Lead → Conversas → Mensagem → Follow-up → Approve → Execute**  
(Execute depende de WhatsApp `CONNECTED`; UI mostra erro da API e link para `/whatsapp`.)

---

## 5. Decisões de UX

1. Composer da conversa tem dois modos:
   - **CRM** → `POST /conversations/:id/messages` (sempre disponível)
   - **WhatsApp** → `POST /whatsapp/send` (só se status `CONNECTED`)
2. Follow-up pode ser criado a partir do detalhe da conversa (`suggestedBody` + `leadId` + `conversationId`).
3. Lead detail ganhou atalhos para Conversas e Follow-ups filtrados por `leadId`.
4. Connect/Disconnect ocultos para `AGENT`.

---

## 6. Fora do escopo

- AI Assist
- Pipeline
- Memberships
- Settings
- Exports / Ops
- Notes / activities / timeline de lead
- Bulk assign

---

## 7. Como reproduzir

```bash
cd apps/api && npm run seed:local && npm run start:dev
cd apps/web && npm install && npm run dev
# http://localhost:3000/login
```

Fluxo manual sugerido:

1. Login → Select company → Leads → abrir lead  
2. Conversas (ou criar conversa com o `leadId`)  
3. Enviar mensagem CRM  
4. Criar follow-up → Aprovar → Executar (requer WA CONNECTED)  
5. `/whatsapp` para connect/QR/status  

---

## 8. Débitos

1. Execute em ambiente local sem Evolution CONNECTED falha com 409 — comportamento correto da API.  
2. Tokens ainda em `localStorage` + cookies de gate (igual Sprint 1).  
3. Polling leve na timeline (10s) e no QR (3s); sem websockets.
