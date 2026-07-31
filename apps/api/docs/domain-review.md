# Domain Review — AutoPilot

**Status:** Revisão crítica da proposta em `domain-model.md`  
**Objetivo:** Expor riscos, ambiguidades e decisões que **bloqueiam** modelagem Prisma segura.  
**Regra:** Na dúvida, não assumir — aguardar decisão.

---

## 1. Possíveis problemas

### 1.1 Escopo de estados do Lead grande demais
A máquina de estados proposta (`new`, `contacted`, `engaged`, `waiting_response`, `follow_up_scheduled`, `qualified`, `converted`, `lost`, `archived`) pode ser excessiva para o MVP.

**Risco:** complexidade de transição, UI confusa, automações frágeis.

**Sugestão:** reduzir a 5–6 estados no MVP e evoluir depois.

### 1.2 Sobreposição Event vs AuditLog
Ambos são gerados em “ações importantes”. Sem fronteira clara, haverá duplicação ou lacunas.

| | Event | AuditLog |
|---|---|---|
| Propósito | fato para reação / integração | trilha de responsabilidade |
| Consumidores | filas, IA, follow-up, n8n | compliance, suporte, admins |
| Mutabilidade | imutável | imutável |

**Risco:** implementar um e esquecer o outro; ou gravar o mesmo payload duas vezes sem critério.

### 1.3 Membership como aggregate vs entidade de Company
Se Membership for aggregate independente, comandos de convite/revogação ficam claros.  
Se for filho de Company, simplifica o modelo mas pode acoplar Identity ao Tenant.

**Risco:** autorização inconsistente se a escolha não for explícita.

### 1.4 Conversation única vs múltiplas por Lead
A regra “1 conversation ativa por Lead+canal” ainda não está fechada.

**Risco:** duplicidade de threads no WhatsApp / Evolution; histórico fragmentado.

### 1.5 Recovery Campaign sem entidade
O glossário cita Recovery Campaign, mas não há aggregate definido.

**Risco:** produto fala em “campanha de recuperação” e o modelo só tem FollowUp avulso — gap de linguagem.

### 1.6 Lead Score ambíguo
Campo `score` vs cálculo derivado vs output da IA.

**Risco:** persistir score sem dono da verdade (humano vs IA vs fórmula).

### 1.7 Soft delete em Event/AuditLog
Aplicar `deleted_at` em logs append-only pode contradizer a ideia de trilha imutável.

**Risco:** compliance fraca se logs puderem ser “apagados” logicamente sem política.

### 1.8 User global vs User-por-Company
User fora do tenant é correto para multi-company, mas complica signup/convite e unique email.

**Risco:** onboarding mal definido (quem cria a primeira Company? convite por e-mail?).

### 1.9 Conversão sem definição comercial
`converted` não especifica o que significa para loja/oficina (venda, visita, orçamento?).

**Risco:** dashboard sem métrica clara de “mais vendas”.

### 1.10 Dependência WhatsApp/Evolution no domínio
Campos `external_*` são necessários, mas o domínio não deve vazar detalhes demais do provider.

**Risco:** modelar Conversation/Message acoplados demais à Evolution.

---

## 2. Ambiguidades

| # | Ambiguidade | Por que importa |
|---|---|---|
| A1 | Quais roles exatamente? (`owner`/`admin`/`agent`?) | Autorização e Membership |
| A2 | Lead `owner_id` obrigatório ou opcional? | Filas de atendimento / SLA |
| A3 | Follow-Up é executado automaticamente (WhatsApp) ou só agenda tarefa humana? | Desenho de `follow-up` + WhatsApp |
| A4 | IA altera status do Lead ou só sugere? | Permissões da AI layer |
| A5 | Message falha de envio: retry automático? | Filas BullMQ futuras |
| A6 | Company.plan faz parte do MVP de dados ou só documentação comercial? | Schema Company |
| A7 | Event.status na mesma tabela ou outbox/processamento separado? | `modules/events` vs `infra/events` |
| A8 | Telefone do Lead é único por Company? | Deduplicação de leads WhatsApp |
| A9 | Conversation.idle é status persistido ou derivado de `last_message_at`? | Jobs vs campo |
| A10 | AuditLog guarda before/after completo sempre? | Volume e LGPD |
| A11 | “Oficina” no ICP vs proibição de módulo Oficina — só leads/conversas? | Clareza comercial/produto |
| A12 | Idioma das enums no banco: inglês ou português? | Convenção técnica |

---

## 3. Decisões pendentes (bloqueantes)

Responder **antes** de criar models Prisma:

### D1 — Estados mínimos do Lead (MVP)
Escolher conjunto fechado. Proposta enxuta:

`new` → `in_progress` → `waiting_response` → `converted` | `lost`

(com `archived` opcional)

### D2 — Papel do Follow-Up no dia 1
- [ ] Apenas **tarefa** para humano
- [ ] **Envio automático** WhatsApp
- [ ] Híbrido (auto + humano)

### D3 — Recovery Campaign
- [ ] Conceito de produto apenas (sem tabela)
- [ ] Entidade `RecoveryCampaign` no MVP
- [ ] Adiar pós-MVP

### D4 — Lead Score
- [ ] Fora do MVP
- [ ] Campo inteiro simples
- [ ] Resultado de IA com histórico

### D5 — Unicidade de Lead
Chave de dedupe sugerida: (`company_id`, `phone`) quando phone existir?

### D6 — Membership roles
Confirmar lista e permissões mínimas.

### D7 — Event processing model
- [ ] Tabela `events` com status
- [ ] Outbox + consumers
- [ ] Primeiro só persistir eventos (sem bus)

### D8 — Soft delete em logs
- [ ] Event/AuditLog **sem** soft delete (imutáveis)
- [ ] Com soft delete só para casos legais excepcionais
- [ ] Seguir regra global cegamente (menos recomendado para logs)

### D9 — Definição de conversão
O que marca `converted` no MVP?

### D10 — Auth provider
Auth local vs Supabase/Auth externo (afeta campos de User).

---

## 4. Sugestões arquiteturais

### 4.1 Congelar linguagem antes do schema
Aprovar `domain-model.md` + respostas D1–D10, **depois** Prisma.

### 4.2 Aggregate Conversation estrito
Repositório/API de Message apenas via Conversation (já alinhado à pasta `modules/conversations`).

### 4.3 TenantContext obrigatório
Todo handler de comando/query de negócio recebe `company_id` do `core/tenancy` — nunca do client sem validar Membership.

### 4.4 Catálogo de eventos versionado
Manter lista de `event.type` em documento (e depois em `shared/constants`) antes de consumidores.

### 4.5 Política de IA explícita
Allowlist de ações da IA (ex.: `suggest_reply`, `classify_lead`) ≠ `delete_*`, `change_role`, `purge_message`.

### 4.6 Separar “idle” derivado
Calcular idle por `last_message_at` + SLA; persistir status só se necessário para busca.

### 4.7 Deduplicação na borda WhatsApp
Normalizar telefone E.164; upsert de Lead/Conversation no webhook com idempotência.

### 4.8 Audit e Event com factories
`AuditService.record(...)` e `EventBus.publish(...)` chamados pelos application services — módulos de domínio não “esquecem” a regra transversal.

### 4.9 MVP de dados enxuto
Primeira migration sugerida (futura):  
Company, User, Membership, Lead, Conversation, Message, FollowUp, Event, AuditLog — **sem** Campaign/Score se D3/D4 adiados.

### 4.10 Dashboard lê projeções, não regras
Métricas a partir de Events/Queries; Dashboard não altera domínio.

---

## 5. Itens explicitamente fora do modelo MVP

Não documentar nem criar:

- Veículo / estoque / anúncio
- Ordem de serviço / oficina
- Financeiro / cobrança completa (além de campo `plan` se aprovado)
- Marketplace
- Test drive
- CRM genérico com pipelines infinitos

---

## 6. Critério de saída desta etapa

Esta etapa de modelagem documental está **pronta para Prisma** somente quando:

1. `domain-model.md` aprovado
2. Decisões D1–D10 respondidas (ou explicitamente adiadas com default)
3. Enums do MVP congelados
4. Recovery Campaign e Lead Score classificados (in/out)

Até lá: **não criar models, não criar migrations, não criar CRUDs.**

---

## 7. Resumo das recomendações do revisor

| Prioridade | Recomendação |
|---|---|
| Alta | Reduzir estados do Lead |
| Alta | Fechar D2 (Follow-Up auto vs humano) |
| Alta | Definir dedupe por telefone |
| Média | Adiar Recovery Campaign como entidade |
| Média | Adiar Lead Score ou campo simples |
| Média | Event append-only agora; bus depois |
| Baixa | Plan/billing só campo opcional na Company |
