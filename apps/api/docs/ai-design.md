# AI Assist MVP Design — Fase 5

**Status:** Design para aprovação (**sem implementação**)  
**Fase:** 5 — AI Assist MVP  
**Pré-requisitos:** Conversations, FollowUp Automation (WhatsApp Fase 4), Ops 4.5  
**Base:** `domain-decisions.md` (D3 híbrido) + `whatsapp-design.md` (D10)  
**Restrições desta etapa de design:**
- **Sem código**
- **Sem migrations**
- **Sem tabelas novas**
- **Sem alteração de schema Prisma**

---

## 1. Objetivo

Implementar geração de **sugestões de resposta** para Conversations usando OpenAI, com **aprovação humana obrigatória** antes de qualquer envio.

```text
Conversation (contexto)
  → AI gera texto sugerido (OpenAI)
  → Persiste como FollowUp SUGGESTED
  → Humano aprova / edita / rejeita
  → execute → WhatsApp Outbound (já existente)
```

**A IA nunca envia mensagens sozinha (D10).**

### Fora do MVP Fase 5

- Auto-send / agent autônomo  
- Fine-tuning / embeddings / RAG externo  
- Análise de sentimento como produto  
- Alteração automática de `Lead.status` pela IA (**A4:** só sugere)  
- Filas BullMQ obrigatórias (chamada sync no request; worker futuro opcional)  
- Frontend dedicado (só APIs)  
- Migrations / tabelas novas / mudança de schema  

---

## 2. Arquitetura

```text
┌──────────────┐   JWT.cid    ┌─────────────────┐
│  Cliente /   │ ───────────► │ AiController    │
│  Agente      │  /ai/...     │ OWNER|ADMIN|    │
└──────────────┘              │ AGENT           │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │ AiService       │
                              │  - carrega ctx  │
                              │  - rate limit   │
                              │  - chama OpenAI │
                              │  - cria FollowUp│
                              └────────┬────────┘
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
           ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
           │ Prisma       │   │ OpenAI       │   │ AuditService │
           │ Conversation │   │ Adapter      │   │              │
           │ Message      │   │ (HTTP API)   │   └──────────────┘
           │ Lead         │   └──────────────┘
           │ FollowUp     │
           └──────────────┘
```

### 2.1 Componentes

| Componente | Responsabilidade |
|---|---|
| `POST /api/ai/conversations/:conversationId/suggest` | Entrada autenticada |
| `AiService.suggestForConversation` | Orquestra contexto + limites + OpenAI + FollowUp |
| `OpenAiClient` (novo em `infra/openai` ou `modules/ai`) | Adapter HTTP Chat Completions |
| `FollowUp` existente | Persistência da sugestão (`SUGGESTED` + `suggestedBody`) |
| `FollowUp.metadata` (já existe) | `{ source: "ai", model, usage, ... }` — **sem schema novo** |
| Fluxo approve/execute | Reutilizado sem mudança de contrato |

### 2.2 Princípios

1. **Reuse FollowUp** — não criar tabela `AiSuggestion`.  
2. **Tenant = JWT.cid** em todas as queries.  
3. **Humano no loop** — só `SUGGESTED`; envio = approve → execute (Fase 4).  
4. **Fail closed** — sem API key / erro OpenAI → 503/502; sem FollowUp parcial opaco.  
5. **Custo controlado** — limites de tokens, histórico curto, rate limit por company.  

---

## 3. Fluxo completo

### 3.1 Gerar sugestão

```text
1. POST /api/ai/conversations/:conversationId/suggest
   Body opcional: { "tone"?, "instruction"?, "persist"?: true }
2. companyId := JWT.cid
3. Carregar Conversation WHERE id AND companyId AND deletedAt null
   → 404 se não existir / cross-tenant
4. Validar Conversation.status ∈ {OPEN, IDLE}
   → 400 se CLOSED/ARCHIVED
5. Carregar Lead da conversation (mesmo companyId)
6. Rate limit / quota (ver §10) → 429 se excedido
7. Carregar últimas N Messages (ex. 20) order by createdAt ASC
8. Montar prompt (system + histórico + dados do lead)
9. Chamar OpenAI Chat Completions (modelo config)
10. Validar resposta (texto não vazio, tamanho ≤ 4096)
11. Se persist=true (default):
      CREATE FollowUp {
        companyId, leadId, conversationId,
        status: SUGGESTED,
        suggestedBody: texto,
        type: "AI_REPLY" | "RECOVERY",
        channel: WHATSAPP,
        assignedUserId: JWT.sub (opcional),
        metadata: {
          source: "ai",
          model,
          promptTokens, completionTokens,
          conversationId,
          generatedAt,
          tone?, instruction?
        }
      }
12. Audit AI_SUGGESTION_CREATED (SYSTEM ou USER actor = JWT.sub)
13. Retornar { followUpId?, suggestion, usage, model }
```

### 3.2 Após a sugestão (já existente — sem redesign)

```text
FollowUp SUGGESTED
  → PATCH (humano edita suggestedBody, só enquanto SUGGESTED)
  → POST .../approve → SCHEDULED
  → POST .../execute → WhatsApp send
  → ou POST .../reject | cancel
```

### 3.3 Diagrama

```text
INBOUND (já no banco)     AGENTE
        │                    │
        │                    ▼
        │            POST /ai/.../suggest
        │                    │
        │                    ▼
        └──────────► Contexto msgs + lead
                             │
                             ▼
                         OpenAI API
                             │
                             ▼
                   FollowUp SUGGESTED
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
           approve        reject         edit+approve
              │
              ▼
           execute → WhatsApp (Fase 4)
```

### 3.4 Trigger automático (fora do MVP sync)

**AI1 recomendação:** MVP = **somente on-demand** (POST explícito).  
Não enfileirar em todo inbound nesta fase (custo + controle).  
Futuro: Event `message.received` → worker (Fase 5.1).

---

## 4. Modelo de dados (sem schema novo)

### 4.1 Persistência da sugestão

Usar **FollowUp** existente:

| Campo | Uso AI MVP |
|---|---|
| `status` | `SUGGESTED` |
| `suggestedBody` | Texto gerado (editável) |
| `leadId` / `conversationId` | Contexto |
| `type` | `"AI_REPLY"` (string livre já suportada) |
| `channel` | `WHATSAPP` |
| `metadata` | Ver §4.2 |
| `assignedUserId` | Opcional: quem pediu a sugestão |

### 4.2 `FollowUp.metadata` (JSON existente)

```json
{
  "source": "ai",
  "model": "gpt-4o-mini",
  "promptTokens": 320,
  "completionTokens": 80,
  "totalTokens": 400,
  "generatedAt": "2026-08-03T19:00:00.000Z",
  "tone": "professional",
  "instruction": "oferecer agendamento",
  "messageIds": ["...", "..."]
}
```

### 4.3 O que **não** criar

- Tabela `ai_suggestions`  
- Tabela `ai_runs`  
- Colunas novas em `messages` / `conversations`  
- Enum Prisma novo  

### 4.4 Mensagens / senderType

Sugestão **não** cria `Message` OUTBOUND.  
Message só nasce no `execute` (WhatsApp).  
`senderType=AI` permanece reservado para futuro; MVP não grava Message da IA.

---

## 5. Endpoints

### 5.1 Propostos

```http
POST /api/ai/conversations/:conversationId/suggest
Authorization: Bearer <access>
```

Roles: **OWNER | ADMIN | AGENT**

### 5.2 Request body (opcional)

```json
{
  "tone": "professional" | "friendly" | "concise",
  "instruction": "string opcional ≤ 500 chars",
  "persist": true
}
```

| Campo | Default | Regra |
|---|---|---|
| `tone` | `professional` | enum fechado |
| `instruction` | omitido | trim, max 500 |
| `persist` | `true` | se `false`, só retorna texto (sem FollowUp) — **AI2** |

**AI2 recomendação:** `persist=true` default; `false` útil para preview.

### 5.3 Response 200

```json
{
  "ok": true,
  "conversationId": "uuid",
  "leadId": "uuid",
  "followUpId": "uuid",
  "suggestion": "Texto sugerido...",
  "model": "gpt-4o-mini",
  "usage": {
    "promptTokens": 320,
    "completionTokens": 80,
    "totalTokens": 400
  }
}
```

Se `persist=false`: `followUpId` = null.

### 5.4 Erros

| Caso | HTTP |
|---|---|
| Sem cid / auth | 401 |
| Role insuficiente | 403 |
| Conversation não encontrada | 404 |
| Conversation CLOSED | 400 |
| Sem mensagens / contexto vazio | 400 |
| Rate limit / quota | 429 |
| `OPENAI_API_KEY` ausente | 503 |
| OpenAI timeout / 5xx | 502 |
| Resposta vazia / inválida | 502 |

### 5.5 Endpoints **não** no MVP

- Streaming SSE  
- Listagem de “AI runs”  
- Regenerar endpoint separado (`suggest` de novo basta)  
- Configuração de prompt por company (usar prompt global + instruction)

---

## 6. Integração OpenAI

### 6.1 Config (já existente)

| Env | Uso |
|---|---|
| `OPENAI_API_KEY` | Obrigatória em runtime para suggest |
| `OPENAI_MODEL` | Default `gpt-4o-mini` |

### 6.2 Adapter

```text
OpenAiClient.chatCompletion({
  model,
  messages: [{ role: 'system'|'user'|'assistant', content }],
  maxTokens,
  temperature
}) → { content, usage }
```

- HTTP `POST https://api.openai.com/v1/chat/completions`  
- Timeout curto (ex. 20–30s)  
- Sem SDK obrigatório no MVP (fetch nativo ok)  
- Stub mode se key vazia → 503 (não inventar texto fake em prod); **AI3:** stub só em `NODE_ENV=test`

### 6.3 Prompt (contrato)

**System (fixo):**
- Assistente de atendimento WhatsApp da company  
- Responder em português (pt-BR)  
- Não inventar preços/políticas não fornecidas  
- Não pedir dados sensíveis desnecessários  
- Uma mensagem curta (≤ ~500–800 chars sugeridos; hard cap 4096)  
- Não mencionar que é IA, salvo pedido  

**User content:**
- Lead: name, phone (parcial?), status, source  
- Últimas N mensagens: `INBOUND/OUTBOUND: texto`  
- Tone + instruction opcional  

### 6.4 Contexto de mensagens

| Parâmetro | Valor MVP |
|---|---|
| `N` últimas msgs | **20** |
| Ignorar | msgs com body null/vazio |
| Ordem | cronológica ASC no prompt |
| Truncate body | ≤ 1000 chars por msg no prompt |

### 6.5 Temperature / max_tokens

| Param | Valor |
|---|---|
| temperature | **0.4** |
| max_tokens | **400** |

---

## 7. Auditoria

| Action | Quando | actorType |
|---|---|---|
| `AI_SUGGESTION_CREATED` | FollowUp criado / sugestão gerada | USER (`JWT.sub`) se persist; ou SYSTEM se job futuro |
| `AI_SUGGESTION_FAILED` | Falha OpenAI após tentativa (opcional, sem FollowUp) | USER |

Snapshots:
```json
{
  "conversationId": "...",
  "leadId": "...",
  "followUpId": "...",
  "model": "...",
  "usage": { "totalTokens": 400 },
  "suggestionPreview": "primeiros 200 chars"
}
```

**Não** auditar o prompt completo (custo/PII).  
Approve/reject/execute continuam com audits FollowUp existentes.

Nota: `AuditService` hoje usa `USER` se `actorUserId` set — adequado. Não exige enum `AI` no schema.

---

## 8. Multi-tenancy

| Regra | Detalhe |
|---|---|
| Tenant | Somente `JWT.cid` |
| Conversation/Lead/Messages | Sempre filtrados por `companyId` |
| FollowUp create | `companyId = cid` |
| Cross-tenant conversationId | 404 |
| OpenAI | Sem enviar `companyId` de outras empresas; contexto só da company |
| Logs | companyId + conversationId; sem API key |
| Isolamento de prompt | Sem dados cross-tenant em cache global (MVP sem cache) |

---

## 9. Custos

### 9.1 Modelo de custo

Custo ≈ tokens (prompt + completion) × preço do modelo.

Drivers:
- Tamanho do histórico (N msgs)  
- Frequência de `/suggest`  
- Regenerações  

### 9.2 Controles MVP

| Controle | Valor |
|---|---|
| max_tokens completion | 400 |
| N mensagens | 20 |
| Truncate por msg | 1000 chars |
| 1 completion por request | sim (sem retries caros; 1 retry opcional em 5xx) |

### 9.3 Visibilidade

Gravar `usage` em `FollowUp.metadata` + audit preview.  
Ops futuro pode agregar tokens por company (não bloqueante).

### 9.4 Sem billing interno

MVP **não** implementa cobrança por token ao cliente SaaS — só proteção operacional.

---

## 10. Limites e rate limit

### 10.1 Limites de conteúdo

| Limite | Valor |
|---|---|
| `instruction` | ≤ 500 chars |
| `suggestedBody` gerado | 1…4096 chars |
| Conversation deve ter | ≥ 1 message com body |

### 10.2 Rate limit (por company)

| Janela | Limite MVP | Resposta |
|---|---|---|
| por minuto | **10** suggests | 429 |
| por dia | **200** suggests | 429 |

Implementação sem Redis obrigatório no design:  
- Contador em memória (single instance) **ou**  
- Contagem de FollowUps `metadata.source=ai` criados no período (SQL) — **preferido multi-instance**

**AI4 recomendação:** quota diária via count SQL em FollowUp; burst/min via Redis se disponível, senão SQL últimos 60s.

### 10.3 Concorrência

Um suggest por conversation por vez (lock otimista / in-flight map) — **AI5** opcional stretch; MVP pode permitir paralelo com risco de 2 FollowUps SUGGESTED (aceitável).

---

## 11. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| IA envia sozinha | Crítica | Só SUGGESTED; execute humano (D10) |
| Alucinação de preço/política | Alta | Prompt “não inventar”; humano edita |
| Vazamento PII para OpenAI | Alta | Só msgs/lead da company; sem docs internos; DPA/OpenAI policy |
| Cross-tenant context | Crítica | Queries com cid |
| Custo explosivo | Alta | Rate limit + max_tokens + N=20 |
| Prompt injection do lead | Média | System prompt + delimitar user content; humano aprova |
| Key ausente em prod | Média | 503 claro |
| Latência OpenAI | Média | Timeout; UX async futuro |
| Duplicar sugestões | Baixa | Agente regenera conscientemente |
| Lead status alterado pela IA | Alta | Proibido no MVP (A4) |

---

## 12. Critérios de aceite (implementação futura)

- [ ] `POST /api/ai/conversations/:id/suggest` autenticado com tenant  
- [ ] Carrega só dados da company  
- [ ] Chama OpenAI com modelo configurável  
- [ ] Cria FollowUp `SUGGESTED` (persist default) **sem migration**  
- [ ] Metadata AI em `FollowUp.metadata`  
- [ ] Audit `AI_SUGGESTION_CREATED`  
- [ ] Rate limit / quota  
- [ ] CLOSED conversation → 400  
- [ ] Sem envio automático WhatsApp  
- [ ] Approve/execute existentes continuam funcionando  
- [ ] Sem tabelas/schema novos  
- [ ] `docs/ai-review.md` após implementação  
- [ ] Testes: tenant, CLOSED, mock OpenAI, persist FollowUp  

---

## 13. Decisões pedindo aprovação

| ID | Pergunta | Recomendação |
|---|---|---|
| **AI1** | Trigger só on-demand (sem auto no inbound)? | **Sim** |
| **AI2** | Suportar `persist=false` (preview)? | **Sim** |
| **AI3** | Stub OpenAI em test; 503 se key vazia fora de test? | **Sim** |
| **AI4** | Quota diária via count FollowUp metadata.source=ai? | **Sim** |
| **AI5** | Lock anti-paralelo por conversation? | **Não** no MVP |
| **AI6** | `type = "AI_REPLY"` no FollowUp? | **Sim** |
| **AI7** | assign suggested FollowUp ao JWT.sub? | **Sim** |
| **AI8** | Idioma fixo pt-BR no system prompt? | **Sim** (MVP) |
| **AI9** | Permitir AGENT chamar suggest? | **Sim** |
| **AI10** | Alterar Lead.status via IA? | **Não** |

---

## 14. Relação com roadmap

| Fase | Estado |
|---|---|
| WhatsApp 1–4 + FollowUp real | Feitas |
| Ops 4.5 | Feita |
| **5 AI Assist MVP** | **Este design** |
| 5.1+ | Auto-suggest no inbound + filas + métricas de tokens no Ops |

---

## 15. Próximo passo

**Aguardar aprovação explícita** deste design (e AI1…AI10).  
Somente após aprovação → implementar AI Assist MVP **sem migrations / sem schema novo**.  
**Nenhum código nesta etapa.**

---

*Fim do design AI Assist MVP (Fase 5).*
