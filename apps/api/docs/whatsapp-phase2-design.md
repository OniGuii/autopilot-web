# WhatsApp Phase 2 Design — Inbound Engine

**Status:** Design para aprovação (**sem implementação**)  
**Fase:** WhatsApp 2 — Inbound Engine  
**Pré-requisitos:** Fase 1 implementada (`whatsapp-phase1-review.md`)  
**Base:** `whatsapp-design.md` (D1–D10) + D11–D18  
**Restrição:** somente documentação nesta etapa — **sem código**.

---

## 1. Objetivo

Receber mensagens **INBOUND** da Evolution via webhook e persistir no domínio AutoPilot:

```text
Webhook Evolution
  → Resolver tenant (WhatsAppInstance.instanceKey)
  → Validar secret + idempotência
  → Resolver/criar Lead
  → Resolver/criar Conversation
  → Criar Message INBOUND
  → Atualizar Conversation.lastMessageAt
  → Audit
```

**Fora da Fase 2 (não implementar):**
- Outbound WhatsApp  
- IA / Follow-up / n8n / Dashboard  
- Filas / BullMQ (processamento **síncrono** no webhook; D3 continua como alvo arquitetural futuro)  
- Alterar connect/disconnect da Fase 1 além do necessário para despachar eventos de mensagem  

---

## 2. Endpoint

Reutiliza o webhook da Fase 1:

```http
POST /api/whatsapp/webhook/:instanceKey
X-Webhook-Secret: <plain-secret>
```

| Event type (conceitual) | Fase 1 | Fase 2 |
|---|---|---|
| `connection.update` | processa status | mantém |
| `messages.upsert` / equivalente inbound | **ignored** | **processa** |
| echo `fromMe` | — | **IGNORED** (D8) |
| grupos / não-texto | — | **IGNORED** (MVP texto) |

---

## 3. Fluxo completo

```text
1. Receber POST /webhook/:instanceKey + body Evolution
2. Lookup WhatsAppInstance WHERE instanceKey AND deletedAt IS NULL
     → 404 se não existir
3. Verificar X-Webhook-Secret com argon2.verify(webhookSecretHash)
     → 401 missing / 403 invalid
4. Se evento de conexão → fluxo Fase 1 (inalterado) → return
5. Se não for mensagem inbound elegível → { ok: true, ignored: true }
6. Extrair:
     - remotePhone (digits-only)
     - externalMessageId (obrigatório para processar)
     - body (texto)
     - fromMe / timestamp / metadata raw
7. Se fromMe === true → Echo Strategy (D8) → ignored
8. Se !externalMessageId → ignored (ou FAILED log; não inventar id)
9. Idempotência:
     EXISTS Message WHERE companyId AND externalMessageId AND deletedAt null
     → { ok: true, duplicate: true }  HTTP 200  (sem side-effects)
10. companyId := instance.companyId
     NUNCA ler companyId do payload
11. Transação única:
     a. Lead = find (companyId, phone digits) ativo
        senão CREATE Lead (ver §6) + flag leadCreated
     b. Conversation = resolve (ver §7)
        senão CREATE + flag conversationCreated
     c. CREATE Message INBOUND
     d. UPDATE Conversation.lastMessageAt = now (e opcional Lead.lastInboundAt/lastContactAt)
     e. Audits aplicáveis (§9)
12. HTTP 200 { ok: true, messageId, leadId, conversationId }
```

### 3.1 Diagrama

```text
Evolution ──► Webhook/:instanceKey
                 │
                 ├─ instanceKey → WhatsAppInstance → companyId
                 ├─ secret OK?
                 ├─ echo / non-text / no external id? → IGNORED
                 ├─ duplicate external_message_id? → 200 noop
                 │
                 └─ $transaction
                       Lead ──────────────┐
                       Conversation ──────┤
                       Message INBOUND ───┤
                       lastMessageAt ─────┤
                       Audit ─────────────┘
```

---

## 4. Tenant (obrigatório)

| Regra | Detalhe |
|---|---|
| Fonte de verdade | `WhatsAppInstance` resolvida por **`instanceKey` do path** |
| Proibido | Qualquer `companyId` / `tenantId` no body do webhook |
| Company | `instance.companyId` apenas |
| Soft-delete instance | tratada como inexistente → 404 |
| Instance de outra company | impossível via key única global |

---

## 5. Idempotência (`external_message_id`)

### 5.1 Estratégia (D4)

1. Extrair id estável Evolution (`key.id` ou equivalente documentado na impl.)  
2. Normalizar como string não vazia  
3. `findFirst({ companyId, externalMessageId, deletedAt: null })`  
4. Se existir → **HTTP 200**, sem criar Lead/Conversation/Message/Audit de negócio  

### 5.2 Partial unique (schema Fase 2)

Já previsto em D4; **criar na implementação** da Fase 2:

```sql
CREATE UNIQUE INDEX uq_messages_company_external_active
ON messages (company_id, external_message_id)
WHERE deleted_at IS NULL AND external_message_id IS NOT NULL;
```

Race: dois webhooks paralelos → um `P2002` → tratar como duplicate 200.

### 5.3 Casos de duplicidade

| Caso | Comportamento |
|---|---|
| Mesmo `external_message_id` reenviado | 200 noop |
| Mesmo texto, ids diferentes | duas Messages (correto) |
| Echo após OUTBOUND com mesmo id | 200 noop / IGNORED (D8) |
| Retry após sucesso parcial (sem unique ainda) | unique + early find evitam duplicata |

---

## 6. Auto Lead Creation

### 6.1 Lookup

```text
phone = normalizeDigits(remoteJid)
Lead WHERE companyId = instance.companyId
      AND phone = phone
      AND deletedAt IS NULL
```

### 6.2 Create (quando não existe)

| Campo | Valor Fase 2 |
|---|---|
| `companyId` | `instance.companyId` |
| `phone` | digits-only |
| `name` | = `phone` |
| `status` | **`CONTACTED`** |
| `ownerId` | `null` |
| `score` | `0` |
| `source` | `WHATSAPP` |
| `lastInboundAt` / `lastContactAt` | `now()` (recomendado) |

### 6.3 Nota vs D9

D9 (design geral) usava `status = NEW`.  
**Fase 2 propõe `CONTACTED`**: o cliente já iniciou contato via WhatsApp; `NEW` seria semanticamente incorreto.

**Decisão a congelar na aprovação:** `P2-L1` — Auto Lead inbound → `CONTACTED` (substitui D9 neste caminho).

### 6.4 Lead existente

- Reutilizar  
- Não sobrescrever `name`/`ownerId`/`score`  
- Atualizar `lastInboundAt` / `lastContactAt`  
- Se status era `NEW`, opcional promover para `CONTACTED` (**recomendado: sim**)

---

## 7. Conversation — estratégia

### 7.1 Opções

#### Opção A — Sempre criar nova Conversation
| Prós | Contras |
|---|---|
| Histórico “thread” isolado por sessão | Fragmenta UI; dashboard open count infla |
| Simples | Perde continuidade do atendimento |

#### Opção B — Sempre reutilizar a mais recente (qualquer status)
| Prós | Contras |
|---|---|
| Uma thread por lead | Reabre CLOSED/ARCHIVED silenciosamente |
| Menos rows | Mistura ciclos comerciais encerrados |

#### Opção C — Reutilizar OPEN/IDLE; criar se só CLOSED/ARCHIVED (**D2 — recomendada**)
| Prós | Contras |
|---|---|
| Continuidade no atendimento ativo | Precisa query “última aberta” |
| Respeita encerramento explícito | Lead pode ter N conversations históricas |
| Já congelado em D2 | — |

### 7.2 Algoritmo proposto (Opção C / D2)

```text
1. Buscar Conversation mais recente WHERE
     companyId AND leadId AND channel=WHATSAPP AND deletedAt null
     AND status IN (OPEN, IDLE)
   ORDER BY lastMessageAt DESC NULLS LAST, createdAt DESC
   LIMIT 1
2. Se achou → reutilizar
3. Senão → CREATE Conversation:
     status = OPEN
     channel = WHATSAPP
     externalThreadId = remoteJid / chat id Evolution (se disponível)
     assignedUserId = null
```

`externalThreadId`: preferir id estável do chat Evolution; unique parcial já existe `(company, channel, external_thread_id)`.

### 7.3 Decisão pedida

Confirmar **Opção C (D2)** como regra da Fase 2.

---

## 8. Message INBOUND

| Campo | Valor |
|---|---|
| `companyId` | da instance |
| `conversationId` | resolvida/criada |
| `direction` | `INBOUND` |
| `body` | texto (trim); vazio → IGNORED se não-texto sem caption |
| `externalMessageId` | id Evolution |
| `status` | `RECEIVED` |
| `contentType` | `TEXT` (MVP) |
| `senderType` | `LEAD` |
| `senderUserId` | `null` |
| `sentAt` | timestamp provider ou `now()` |
| `metadata` | JSON: raw keys úteis (pushName, messageType, stub flags) — **sem** companyId inventado |
| `createdAt` | default DB |

Sender = **cliente** (`senderType=LEAD`).

Na mesma `$transaction`: `Conversation.lastMessageAt = sentAt|now`.

---

## 9. Auditoria

Na mesma transação da mutação de negócio:

| Condição | `action` | `targetType` |
|---|---|---|
| Sempre (msg criada) | `WHATSAPP_MESSAGE_RECEIVED` | `MESSAGE` |
| Lead auto-criado | `LEAD_AUTO_CREATED` | `LEAD` |
| Conversation auto-criada | `CONVERSATION_AUTO_CREATED` | `CONVERSATION` |

Campos comuns:
- `companyId` = instance.companyId  
- `actorType` = `SYSTEM` (webhook; `actorUserId` null)  
- `before`/`after` snapshots mínimos  

**Não** auditar duplicates/ignored (evitar ruído).

### 9.1 WebhookEvent (D5)

**Recomendação Fase 2:** persistir `WebhookEvent` (RECEIVED→PROCESSED/IGNORED/FAILED) **síncrono**, sem fila.  
Se quiser escopo mínimo absoluto, pode-se adiar a tabela e só usar Audit — mas D5 pede persistência no roadmap; **incluir migration `webhook_events` na Fase 2** é a proposta.

**Decisão a congelar:** `P2-W1` — criar `WebhookEvent` nesta fase (sim/não).

---

## 10. Echo Messages (D8) — lembrete

1. `fromMe` / equivalente → não criar INBOUND de cliente  
2. Se `external_message_id` já existe (OUTBOUND prévio) → noop  
3. Não criar Lead/Conversation só por echo  

---

## 11. Casos de erro

| Caso | HTTP | Body |
|---|---|---|
| `instanceKey` desconhecido | 404 | Unknown instance |
| Secret ausente | 401 | Missing X-Webhook-Secret |
| Secret inválido | 403 | Invalid webhook secret |
| Payload inválido / sem parser | 200 | `{ ok: true, ignored: true }` (não 5xx para evitar storm) |
| Falta `externalMessageId` | 200 | ignored |
| Echo / grupo / mídia sem texto | 200 | ignored |
| Duplicate message | 200 | `{ ok: true, duplicate: true }` |
| Unique race P2002 | 200 | duplicate |
| Erro DB inesperado | 500 | Evolution pode retentar |

Princípio: **erros de negócio/ignorar → 2xx**; **auth/tenant → 4xx**; **infra → 5xx**.

---

## 12. Riscos cross-tenant

| Risco | Mitigação |
|---|---|
| Payload com companyId falso | Ignorado; só `instance.companyId` |
| instanceKey de outra empresa | UUID + secret; sem enumeração útil |
| Phone igual em duas companies | Unique por company — OK leads separados |
| Conversation/Lead id no payload | Não aceitar; só phone + company |
| Secret vazado | Rotação no reconnect Fase 1; HTTPS |
| Processar mensagem com instance DISCONNECTED | **Proposta:** ainda aceitar inbound se instance existir (histórico); ou exigir CONNECTED — **decidir `P2-S1`** |

---

## 13. Impactos em módulos existentes

| Módulo | Impacto |
|---|---|
| Leads | Auto-create; possível bump NEW→CONTACTED |
| Conversations | Auto-create / reuse D2; `lastMessageAt` |
| Messages | Novas INBOUND com `externalMessageId` |
| Dashboard | Contadores inbound sobem automaticamente |
| FollowUp / IA / WhatsApp outbound | Sem mudança |
| Webhook Fase 1 | Branch por event type |

---

## 14. Schema / migrations planejadas (após aprovação)

1. Partial unique `uq_messages_company_external_active` (D4)  
2. (Opcional recomendado) tabela `webhook_events` (D5)  
3. **Sem** mudança em Auth/FollowUp  

---

## 15. Arquitetura de processamento

| Aspecto | Fase 2 |
|---|---|
| Sync no request | **Sim** (obrigatório nesta fase — sem BullMQ) |
| Handler extraível | `processInboundMessage(companyId, dto)` para plugar fila depois (D3) |
| Timeout | Manter lógica curta; metadata raw truncada se necessário |

---

## 16. Decisões pedindo aprovação explícita

| ID | Pergunta | Recomendação |
|---|---|---|
| **P2-L1** | Auto Lead status `CONTACTED` (vs D9 `NEW`)? | **CONTACTED** |
| **P2-L2** | Promover Lead `NEW` → `CONTACTED` no inbound? | **Sim** |
| **P2-C1** | Conversation Opção C (D2)? | **Sim** |
| **P2-W1** | Criar tabela `WebhookEvent` na Fase 2? | **Sim** |
| **P2-S1** | Aceitar inbound se instance não está CONNECTED? | **Sim** (persistir histórico) |
| **P2-T1** | Atualizar `Lead.lastInboundAt` / `lastContactAt`? | **Sim** |

### Nota sobre D9

O design geral (`whatsapp-design.md` D9) previa `status = NEW` para auto-Lead.  
A Fase 2 **propõe substituir** esse default por `CONTACTED` no caminho inbound WhatsApp (P2-L1).  
Aprovar P2-L1 congela a correção; o doc geral deve ser atualizado na implementação.

---

## 17. Critérios de aceite (implementação futura)

- [ ] Webhook processa inbound com tenant via `instanceKey`  
- [ ] Sem `companyId` do payload  
- [ ] Idempotência `external_message_id` + partial unique  
- [ ] Auto Lead + auto Conversation conforme decisões  
- [ ] Message INBOUND + `lastMessageAt` na mesma tx  
- [ ] Audits `WHATSAPP_MESSAGE_RECEIVED` / `LEAD_AUTO_CREATED` / `CONVERSATION_AUTO_CREATED`  
- [ ] Echo/grupos/non-text ignored  
- [ ] Sem outbound / IA / FollowUp / filas  
- [ ] `docs/whatsapp-phase2-review.md`  

---

## 18. Próximo passo

**Aguardar aprovação** deste design (e P2-L1…P2-T1).  
Somente após aprovação explícita → implementar Fase 2.
