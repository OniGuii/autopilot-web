# WhatsApp Implementation Plan — Fase 1 (Conexão Evolution)

**Status:** Planejamento para aprovação (**sem implementação**)  
**Escopo:** somente **Fase 1 — Conexão**  
**Base:** `whatsapp-design.md` (aprovado, decisões D1–D10 congeladas)  
**Restrição desta etapa:** **não** escrever código, **não** criar migrations, **não** criar endpoints, **não** alterar schema agora — apenas planejar.

Fora desta Fase 1:
- Inbound de mensagens  
- Outbound / send-message  
- FollowUp real send  
- IA  
- Tabela `WebhookEvent` / `MessageSync` (ficam no roadmap; D5 obriga WebhookEvent a partir da Fase 2)

---

## 1. Objetivo da Fase 1

Permitir que uma Company:

1. **Conecte** uma instância Evolution (1:1 — D1)  
2. Receba / exiba **QR Code** (ou código de pairing)  
3. Consulte **status** da conexão  
4. **Desconecte** a instância  
5. Receba webhooks de **CONNECTION_UPDATE** (mínimo necessário para atualizar status)

Ao final da Fase 1 (quando implementada), o AutoPilot sabe se a company está `QR_PENDING`, `CONNECTING`, `CONNECTED`, `DISCONNECTED` ou `ERROR` — **sem** processar mensagens de chat ainda.

---

## 2. Entidades necessárias (Fase 1)

### 2.1 `WhatsAppInstance` (nova — única entidade de dados da Fase 1)

| Campo | Tipo proposto | Null | Notas |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `company_id` | UUID | NO | FK → companies; **unique parcial ativo** (D1) |
| `instance_key` | VARCHAR(100) | NO | chave pública no path do webhook (`:instanceKey`); unique global |
| `evolution_instance_name` | VARCHAR(100) | NO | nome na Evolution (pode = instance_key) |
| `evolution_instance_id` | VARCHAR(191) | YES | id externo se a API retornar |
| `status` | ENUM/TEXT | NO | ver §6 |
| `phone_number` | VARCHAR(32) | YES | digits, quando CONNECTED |
| `webhook_secret` | VARCHAR(255) | NO | valor de `X-Webhook-Secret` (D7) |
| `qr_code` | TEXT | YES | último QR/base64 (curto prazo; opcional limpar após CONNECTED) |
| `qr_expires_at` | TIMESTAMPTZ | YES | se conhecido |
| `last_connected_at` | TIMESTAMPTZ | YES | |
| `last_disconnected_at` | TIMESTAMPTZ | YES | |
| `last_error` | VARCHAR(1000) | YES | |
| `metadata` | JSONB | YES | raw Evolution opcional |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMPTZ | | soft delete |

**Constraints planejadas:**
- PK (`id`)
- FK `company_id` → `companies(id)`
- UNIQUE parcial: `(company_id) WHERE deleted_at IS NULL` → **1 instance ativa por company (D1)**
- UNIQUE: `instance_key` (global)
- UNIQUE: `evolution_instance_name` (global, evita colisão na Evolution)

**Índices:**
- `status`
- `company_id`

### 2.2 Entidades **não** criadas na Fase 1

| Entidade | Quando |
|---|---|
| `WebhookEvent` | Fase 2 (obrigatória no roadmap — D5); Fase 1 pode logar connection events de forma mínima ou já criar stub — **recomendação:** criar `WebhookEvent` só na Fase 2; na Fase 1 connection webhooks atualizam `WhatsAppInstance` direto + audit |
| `MessageSync` | Fase 3+ |
| Alterações em `messages` (partial unique external id) | Fase 2 (D4) |

### 2.3 Enum conceitual `WhatsAppConnectionStatus`

```text
QR_PENDING
CONNECTING
CONNECTED
DISCONNECTED
ERROR
```

Implementação: Prisma `enum` **ou** string validada na app (preferência: enum Prisma alinhado ao restante do schema).

---

## 3. Alterações de schema (planejadas — não executar agora)

### 3.1 Migration futura (nome sugerido)

`YYYYMMDDHHMMSS_whatsapp_instance`

### 3.2 Conteúdo planejado

1. Create enum `WhatsAppConnectionStatus` (se enum)  
2. Create table `whatsapp_instances`  
3. Partial unique `uq_whatsapp_instances_company_active`  
4. Unique `instance_key`, `evolution_instance_name`  
5. FKs e índices  

### 3.3 `schema.prisma` (esboço — não aplicar)

```prisma
enum WhatsAppConnectionStatus {
  QR_PENDING
  CONNECTING
  CONNECTED
  DISCONNECTED
  ERROR
}

model WhatsAppInstance {
  id                     String                     @id @default(uuid()) @db.Uuid
  companyId              String                     @map("company_id") @db.Uuid
  instanceKey            String                     @unique @map("instance_key") @db.VarChar(100)
  evolutionInstanceName  String                     @unique @map("evolution_instance_name") @db.VarChar(100)
  evolutionInstanceId    String?                    @map("evolution_instance_id") @db.VarChar(191)
  status                 WhatsAppConnectionStatus
  phoneNumber            String?                    @map("phone_number") @db.VarChar(32)
  webhookSecret          String                     @map("webhook_secret") @db.VarChar(255)
  qrCode                 String?                    @map("qr_code")
  qrExpiresAt            DateTime?                  @map("qr_expires_at") @db.Timestamptz(6)
  lastConnectedAt        DateTime?                  @map("last_connected_at") @db.Timestamptz(6)
  lastDisconnectedAt     DateTime?                  @map("last_disconnected_at") @db.Timestamptz(6)
  lastError              String?                    @map("last_error") @db.VarChar(1000)
  metadata               Json?
  createdAt              DateTime                   @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime                   @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt              DateTime?                  @map("deleted_at") @db.Timestamptz(6)

  company Company @relation(fields: [companyId], references: [id])

  @@index([companyId])
  @@index([status])
  @@map("whatsapp_instances")
}
```

Partial unique de company ativa: SQL custom na migration (padrão AutoPilot).

### 3.4 Relação em `Company`

Adicionar `whatsappInstances WhatsAppInstance[]` (ou `whatsappInstance` se 1:1 modelado na app).

---

## 4. Endpoints futuros (Fase 1) — não implementar agora

| Método | Path | Auth | Descrição |
|---|---|---|---|
| `POST` | `/api/whatsapp/connect` | JWT + company + **OWNER/ADMIN** | Cria/reativa instance; chama Evolution; retorna QR |
| `GET` | `/api/whatsapp/status` | JWT + company + OWNER/ADMIN/AGENT | Status + phone + timestamps |
| `GET` | `/api/whatsapp/qr` | JWT + company + OWNER/ADMIN | (opcional) reobter QR se `QR_PENDING` |
| `POST` | `/api/whatsapp/disconnect` | JWT + company + OWNER/ADMIN | Logout Evolution + status DISCONNECTED |
| `POST` | `/api/whatsapp/webhook/:instanceKey` | Público + `X-Webhook-Secret` | Só eventos de **conexão** na Fase 1 |

**Explicitamente fora da Fase 1:**
- `POST /api/whatsapp/send-message`
- Processamento de `messages.upsert` (responder 200 IGNORED ou filtrar por event type)

### 4.1 Contratos esboço

**POST /connect**
```json
// request: {} ou { "force": false }
// response 200
{
  "companyId": "...",
  "instanceKey": "autopilot_<companySlug>",
  "status": "QR_PENDING",
  "qrCode": "data:image/png;base64,...",
  "qrExpiresAt": "..."
}
```

**GET /status**
```json
{
  "companyId": "...",
  "instanceKey": "...",
  "status": "CONNECTED",
  "phoneNumber": "5511999990000",
  "lastConnectedAt": "...",
  "lastError": null
}
```

**POST /disconnect**
```json
{ "ok": true, "status": "DISCONNECTED" }
```

**POST /webhook/:instanceKey** (Fase 1 — connection only)
```http
X-Webhook-Secret: <secret>
```
Payload Evolution `connection.update` / equivalente → atualiza `status`, `phoneNumber`, limpa `qrCode` se CONNECTED.

---

## 5. Fluxo de conexão

```text
OWNER/ADMIN (JWT.cid)
        │
        ▼
POST /whatsapp/connect
        │
        ├─ Se já existe instance ACTIVE da company:
        │     reconnect / refresh QR (se DISCONNECTED|ERROR|QR_PENDING)
        │     se já CONNECTED → 200 status atual (idempotente) ou 409 (decisão impl.)
        │
        ├─ Gerar instanceKey estável (ex.: autopilot_<slug>_<shortId>)
        ├─ Gerar webhookSecret (random 32+ bytes)
        ├─ Persistir WhatsAppInstance status=QR_PENDING
        │
        ├─ Evolution API:
        │     create instance (se não existe)
        │     set webhook URL =
        │       {API_PUBLIC_URL}/api/whatsapp/webhook/{instanceKey}
        │     set webhook headers / secret conforme Evolution
        │     get QR / connect
        │
        ├─ Salvar qrCode (+ qrExpiresAt se houver)
        └─ Audit: WHATSAPP_CONNECT (futuro action name)

Evolution → webhook connection.update
        │
        ├─ Validar instanceKey + X-Webhook-Secret
        ├─ Mapear status Evolution → enum interno
        ├─ CONNECTED: set phoneNumber, lastConnectedAt, clear qr
        ├─ DISCONNECTED: lastDisconnectedAt
        └─ ERROR: lastError
```

### 5.1 Multi-tenancy na conexão

- `companyId` = `JWT.cid` no connect/status/disconnect  
- Webhook: `companyId` = `WhatsAppInstance.companyId` via `instanceKey`  
- Nunca aceitar `companyId` do body  

### 5.2 Config Evolution

| Env | Uso Fase 1 |
|---|---|
| `EVOLUTION_API_URL` | Base URL |
| `EVOLUTION_API_KEY` | Auth admin Evolution |
| `API_PUBLIC_URL` (novo, planejado) | URL pública para registrar webhook |
| `EVOLUTION_INSTANCE` | **Deprecar** para multi-tenant; usar nome por company |

---

## 6. QR Code

| Aspecto | Plano |
|---|---|
| Fonte | Evolution `connect` / `qrcode` endpoint (versão da API a fixar na impl.) |
| Transporte ao client | Campo `qrCode` (base64 data URL ou string raw documentada) |
| Persistência | Opcional em DB para `GET /qr` sem reconsultar Evolution; limpar ao CONNECTED |
| Expiração | Se Evolution indicar TTL → `qrExpiresAt`; client deve refrescar via connect/qr |
| Segurança | Só OWNER/ADMIN; nunca expor em webhook logs sem redaction |
| UX | Fora do backend (frontend consome status/qr) — Fase 1 API only |

Refresh QR:
- Se status `QR_PENDING` e QR expirado → `GET /qr` ou `POST /connect` com `forceRefreshQr=true`

---

## 7. Estados (Fase 1)

```text
(connect) ──► QR_PENDING ──► CONNECTING ──► CONNECTED
                 │                │              │
                 └────── ERROR ◄──┴──────────────┤
                                                 ▼
                                           DISCONNECTED
                                                 │
                                          (reconnect)
                                                 ▼
                                            QR_PENDING
```

| Status | Quem seta | Comportamento Fase 1 |
|---|---|---|
| `QR_PENDING` | connect / QR novo | Aguarda scan |
| `CONNECTING` | webhook | Transição |
| `CONNECTED` | webhook | Pronto para fases 2–3 |
| `DISCONNECTED` | webhook / disconnect | Bloqueia send futuro |
| `ERROR` | webhook / falha API | `lastError` preenchido |

**Gate futuro (não Fase 1):** outbound só se `CONNECTED`.

---

## 8. Arquitetura (D3) aplicada à Fase 1

```text
POST /webhook/:instanceKey
  → validar secret
  → (alvo) enqueue ConnectionEventJob
  → (MVP permitido) processar sync no request
  → atualizar WhatsAppInstance
```

Mesmo no sync inicial:
- Extrair handler `processConnectionEvent(instance, payload)`  
- Interface pronta para worker Redis/Bull depois  
- Responder 2xx rápido após aceitar evento válido  

**Não** processar mensagens de chat na Fase 1 (ACK + ignore / early return por `event` type).

---

## 9. Auditoria planejada (Fase 1)

| Ação | Quando |
|---|---|
| `WHATSAPP_CONNECT` | connect bem-sucedido (instance criada/atualizada) |
| `WHATSAPP_DISCONNECT` | disconnect |
| `WHATSAPP_STATUS_CHANGE` | webhook altera status (opcional se ruidoso; senão só connect/disconnect) |

Mesma transação da mutação de `WhatsAppInstance` quando aplicável.

---

## 10. Riscos da Fase 1

| Risco | Severidade | Mitigação |
|---|---|---|
| QR expira antes do scan | Média | endpoint refresh; `qrExpiresAt` |
| Webhook URL inacessível (localhost) | Alta | `API_PUBLIC_URL` + tunnel em dev documentado |
| Secret fraco / vazado | Alta | gerar crypto random; HTTPS; não logar secret |
| Duas connects concorrentes na mesma company | Média | unique parcial + transaction / upsert |
| Colisão `instance_key` na Evolution | Média | naming com slug+uuid curto |
| Evolution API breaking changes | Média | adapter isolado `EvolutionClient` |
| Status dessincronizado (webhook perdido) | Média | `GET /status` também consulta Evolution (poll opcional) |
| AGENT chama connect | Baixa | RolesGuard OWNER/ADMIN |
| Soft-delete instance e recriar | Baixa | nova row; unique parcial só ativos |
| Processar message event cedo demais | Alta | allowlist de eventos de conexão na Fase 1 |

---

## 11. Critérios de aceite (quando a Fase 1 for implementada)

- [ ] Tabela `whatsapp_instances` + partial unique 1:1 company  
- [ ] `POST /api/whatsapp/connect` cria/reativa instance e retorna QR  
- [ ] `GET /api/whatsapp/status` reflete status persistido  
- [ ] `POST /api/whatsapp/disconnect` desconecta e seta `DISCONNECTED`  
- [ ] `POST /api/whatsapp/webhook/:instanceKey` valida `X-Webhook-Secret`  
- [ ] Webhook atualiza estados CONNECTED/DISCONNECTED/ERROR/CONNECTING  
- [ ] Multi-tenant: `JWT.cid` / instanceKey mapping; sem `companyId` do client  
- [ ] Eventos de mensagem **não** criam Lead/Message na Fase 1  
- [ ] Audit connect/disconnect  
- [ ] Docs atualizados (`whatsapp-review-phase1.md` sugerido)  
- [ ] Testes locais: connect → status QR → (mock webhook) CONNECTED → disconnect  

---

## 12. Ordem de implementação sugerida (após aprovação deste plano)

1. Migration + Prisma model `WhatsAppInstance`  
2. `EvolutionClient` (create/connect/qr/logout/status)  
3. `WhatsappConnectionService` + controller endpoints auth  
4. Webhook connection-only + secret validation  
5. Audit + testes manuais/e2e com Evolution de staging ou mock  
6. Documentar `API_PUBLIC_URL` / tunnel no `local-bootstrap.md`  

---

## 13. Explicitamente NÃO fazer nesta etapa de documentação

- Alterar `schema.prisma`  
- Criar migration  
- Criar controller/service/DTO  
- Registrar rotas  
- Mudar FollowUp execute  
- Criar `WebhookEvent` table  

---

## 14. Próximo passo

**Aguardar aprovação** deste plano da Fase 1.  
Somente após aprovação explícita → implementar conexão Evolution conforme §11–§12.
