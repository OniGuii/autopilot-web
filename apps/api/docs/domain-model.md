# Modelo de Domínio — AutoPilot

**Status:** Aprovado — decisões congeladas em `domain-decisions.md`  
**Escopo:** MVP — recuperação e conversão de leads com IA  
**Idioma ubíquo:** português (Brasil), com nomes técnicos de entidade em English PascalCase

Este documento é a **fonte oficial da linguagem do domínio**.  
Decisões oficiais do MVP: [`domain-decisions.md`](./domain-decisions.md).  
Modelo relacional: [`database-model.md`](./database-model.md).  
Não substitui código. Nenhuma entidade Prisma/migration foi criada a partir dele ainda.

---

## 1. Visão do domínio

O AutoPilot **não é um CRM genérico**.

É uma plataforma multi-tenant que:

1. Concentra leads e conversas (principalmente WhatsApp)
2. Detecta leads sem acompanhamento
3. Dispara follow-ups / recuperação
4. Usa IA como camada auxiliar (classificação, sugestão, insights)
5. Registra eventos e auditoria de ações importantes

**Promessa de valor:** mais vendas por menos leads perdidos.

**Fora do domínio MVP:** ERP, financeiro, estoque, oficina/OS, marketplace, cadastro de veículos, test drive.

---

## 2. Glossário oficial

| Termo | Definição |
|---|---|
| **Tenant** | Isolamento lógico de dados de um cliente da plataforma. No AutoPilot, o tenant é a **Company**. |
| **Company** | Organização assinante do SaaS (loja, revenda ou oficina). Raiz do multi-tenancy. |
| **User** | Pessoa física com credenciais de acesso à plataforma. |
| **Membership** | Vínculo entre User e Company, com papel (role) e status. Um User pode ter Memberships em várias Companies. |
| **Lead** | Pessoa ou contato interessado em comprar / ser atendido. Unidade central de recuperação e conversão. |
| **Conversation** | Thread de comunicação com um Lead em um canal (ex.: WhatsApp). Contém Messages. |
| **Message** | Unidade de mensagem dentro de uma Conversation (inbound ou outbound). **Não** é agregado próprio; pertence a Conversation. |
| **Follow-Up** | Ação de recontato. No MVP é **híbrido**: sistema sugere → usuário aprova → sistema envia. |
| **Recovery Campaign** | Conceito de produto para V2. **Sem entidade no MVP.** |
| **Lead Score** | Campo numérico `score` (0–100) em Lead. **Sem entidade própria.** |
| **Event** | Fato de domínio imutável que ocorreu no sistema (ex.: `lead.created`, `message.received`). |
| **AuditLog** | Registro de auditoria de uma ação importante (quem, o quê, quando, em qual Company). |
| **Canal** | Meio de comunicação (MVP: WhatsApp via Evolution API). |
| **IA (AI Layer)** | Camada auxiliar que classifica, sugere e gera insights. Sem poder destrutivo. |
| **Soft Delete** | Exclusão lógica via `deleted_at`; nunca remoção física. |
| **Conversão (`CONVERTED`)** | Objetivo comercial alcançado (visita, avaliação, proposta, financiamento ou venda). Não exige venda fechada. |
| **Role** | Papel do Membership: `OWNER`, `ADMIN`, `AGENT` apenas. |

---

## 3. Bounded Contexts

| Context | Responsabilidade | Módulo Nest (previsto) |
|---|---|---|
| **Identity & Access** | User, autenticação, Membership, papéis | `auth`, `users` |
| **Tenant / Organization** | Company, planos futuros, limites | `companies` |
| **Lead Management** | Ciclo de vida do Lead, score, ownership | `leads` |
| **Conversations** | Conversation + Message, histórico | `conversations` |
| **WhatsApp Channel** | Integração Evolution, webhooks, envio | `whatsapp` |
| **Follow-Up & Recovery** | Agendamento e execução de recontatos | `follow-up` |
| **AI Assist** | Classificação, sugestões, insights | `ai` |
| **Events** | Publicação/consumo de eventos de domínio | `events` (+ `infra/events`) |
| **Audit** | Trilha de auditoria | `audit` |
| **Insights / Dashboard** | Métricas de recuperação e conversão | `dashboard` |

**Nota:** Contexts colaboram via **Events**. Regras de negócio ficam no backend; n8n não contém regras.

---

## 4. Agregados e entidades raiz

| Aggregate Root | Entidades internas | Notas |
|---|---|---|
| **Company** | — | Raiz do tenant. |
| **User** | — | Identidade global à plataforma. |
| **Membership** | — | Aggregate próprio. Único vínculo User↔Company (D8). |
| **Lead** | (opcional) tags/notas futuras | Ownership e status no root. |
| **Conversation** | **Message** | Messages só existem dentro de Conversation. |
| **FollowUp** | — | Referencia Lead (e opcionalmente Conversation). |
| **Event** | — | Append-only; não é “editável”. |
| **AuditLog** | — | Append-only. |

```text
Company (AR)
 ├── Membership (vínculo User↔Company)
 └── (escopo de dados)
      ├── Lead (AR)
      ├── Conversation (AR)
      │    └── Message
      ├── FollowUp (AR)
      ├── Event
      └── AuditLog

User (AR) ──< Membership >── Company
```

---

## 5. Entidades detalhadas

Convenções comuns (todas as entidades persistidas):

| Campo | Obrigatório | Descrição |
|---|---|---|
| `id` | sim | Identificador único (UUID recomendado) |
| `created_at` | sim | Criação |
| `updated_at` | sim | Última atualização |
| `deleted_at` | sim (nullable) | Soft delete |

Entidades de tenant incluem `company_id`, exceto `User` (global) — Users acessam Companies via Membership.

---

### 5.1 Company

#### Objetivo
Representar o cliente SaaS (loja/revenda/oficina) e ser a **fronteira de isolamento** multi-tenant.

#### Descrição
Organization que contrata o AutoPilot. Todos os Leads, Conversas, Follow-Ups, Events e AuditLogs de negócio pertencem a uma Company.

#### Responsabilidades
- Isolar dados do tenant
- Agrupar Memberships (usuários da equipe)
- Futuro: plano (Starter/Growth/Pro), limites, conexões WhatsApp

#### Ciclo de vida
1. **Provisioning** — Company criada (signup / onboarding)
2. **Active** — operando normalmente
3. **Suspended** — acesso bloqueado (inadimplência / abuso) — *futuro*
4. **Closed** — encerrada (soft delete)

#### Estados possíveis
| Status | Significado |
|---|---|
| `active` | Operacional |
| `suspended` | Temporariamente bloqueada |
| `closed` | Encerrada (também pode mapear para `deleted_at`) |

#### Relacionamentos
- 1 Company → N Memberships
- 1 Company → N Leads, Conversations, FollowUps, Events, AuditLogs
- N Companies ↔ N Users (via Membership)

#### Regras de negócio
1. Nenhuma entidade de negócio existe sem `company_id` (exceto User).
2. Queries de domínio sempre filtradas por Company.
3. Soft delete da Company **não** apaga fisicamente dados filhos.
4. IA e automações só atuam dentro da Company do contexto.

#### Campos sugeridos
| Campo | Tipo sugerido | Notas |
|---|---|---|
| `id` | uuid | PK |
| `name` | string | Nome fantasia / razão social comercial |
| `slug` | string | Identificador único amigável (opcional) |
| `status` | enum | `active`, `suspended`, `closed` |
| `timezone` | string | Ex.: `America/Sao_Paulo` |
| `plan` | enum/string | `starter`, `growth`, `pro` — *billing futuro* |
| `created_at` / `updated_at` / `deleted_at` | datetime | |

---

### 5.2 User

#### Objetivo
Identidade de autenticação de uma pessoa na plataforma.

#### Descrição
Credencial e perfil básico. **Não** carrega permissões sozinho — permissões vêm do Membership na Company atual.

#### Responsabilidades
- Autenticar-se
- Possuir um ou mais Memberships
- Ser referenciado em auditoria e ownership de Lead

#### Ciclo de vida
1. **Invited / Registered**
2. **Active**
3. **Disabled**
4. Soft-deleted

#### Estados possíveis
| Status | Significado |
|---|---|
| `pending` | Convite / e-mail não confirmado |
| `active` | Pode autenticar |
| `disabled` | Bloqueado |

#### Relacionamentos
- 1 User → N Memberships
- 1 User → N AuditLogs (como ator)
- 1 User → N Leads (como `owner` / responsável)

#### Regras de negócio
1. User sem Membership ativo **não** acessa dados de Company.
2. Contexto de request sempre resolve: User + Company (tenant) via Membership.
3. Soft delete de User não remove AuditLogs históricos.

#### Campos sugeridos
| Campo | Tipo sugerido | Notas |
|---|---|---|
| `id` | uuid | PK |
| `email` | string | Único |
| `name` | string | |
| `password_hash` | string | Se auth local; omitir se provider externo |
| `status` | enum | `pending`, `active`, `disabled` |
| `last_login_at` | datetime? | |
| `created_at` / `updated_at` / `deleted_at` | datetime | |

---

### 5.3 Membership

#### Objetivo
Vincular User ↔ Company com papel e status.

#### Descrição
Define **quem pode fazer o quê** dentro de um tenant. É a base de autorização multi-tenant.

#### Responsabilidades
- Autorizar acesso à Company
- Carregar role
- Permitir convite / remoção de membros

#### Ciclo de vida
1. **Invited**
2. **Active**
3. **Revoked** (ou soft delete)

#### Estados possíveis
| Status | Significado |
|---|---|
| `invited` | Convite pendente |
| `active` | Membro ativo |
| `revoked` | Acesso removido |

#### Relacionamentos
- Membership N:1 User
- Membership N:1 Company
- Unicidade sugerida: (`company_id`, `user_id`)

#### Regras de negócio
1. Todo acesso a dados da Company exige Membership `active`.
2. Roles oficiais do MVP (D7): `OWNER`, `ADMIN`, `AGENT` — nenhuma adicional.
3. User nunca pertence diretamente à Company (D8); Membership é obrigatória.
4. Revogar Membership não apaga Leads/Conversas criados pelo usuário.
5. Deve existir pelo menos um `OWNER` ativo por Company (regra operacional recomendada).

#### Campos sugeridos
| Campo | Tipo sugerido | Notas |
|---|---|---|
| `id` | uuid | PK |
| `company_id` | uuid | FK tenant |
| `user_id` | uuid | FK |
| `role` | enum | `OWNER`, `ADMIN`, `AGENT` |
| `status` | enum | `invited`, `active`, `revoked` |
| `invited_by` | uuid? | User |
| `joined_at` | datetime? | |
| `created_at` / `updated_at` / `deleted_at` | datetime | |

---

### 5.4 Lead

#### Objetivo
Representar o contato/oportunidade a ser acompanhado, recuperado e convertido.

#### Descrição
Unidade central do produto. Lead parado sem resposta é a dor principal que o AutoPilot resolve.

#### Responsabilidades
- Manter dados de contato e origem
- Refletir estágio no funil de acompanhamento
- Ser alvo de Follow-Ups e Conversations
- Receber classificação/score (humano ou IA)

#### Ciclo de vida (MVP — D1)
1. **NEW** — recém-criado
2. **CONTACTED** — primeiro contato realizado
3. **RESPONDED** — cliente respondeu
4. **QUALIFIED** — interesse real demonstrado
5. **CONVERTED** ou **LOST** — encerramento
6. Soft-deleted (quando aplicável)

#### Estados possíveis (oficiais — D1)
| Status | Significado |
|---|---|
| `NEW` | Lead recém-criado |
| `CONTACTED` | Primeiro contato realizado |
| `RESPONDED` | Cliente respondeu |
| `QUALIFIED` | Lead demonstrou interesse real |
| `CONVERTED` | Objetivo comercial alcançado (D2) |
| `LOST` | Encerrado sem conversão |

**Não existem outros estados no MVP.**

#### Relacionamentos
- Lead N:1 Company
- Lead N:1 User? (`owner_id` opcional)
- Lead 1:N Conversations
- Lead 1:N FollowUps
- Lead gera Events

#### Regras de negócio
1. Lead sempre pertence a exatamente uma Company.
2. `phone` é obrigatório e **único por Company** (D6); pode repetir entre Companies.
3. Soft delete não remove histórico de Messages/Events.
4. Follow-Up é híbrido (D3): sistema sugere → usuário aprova → sistema envia.
5. IA pode **sugerir** status/score; não aplica mudanças destrutivas.
6. IA **não** pode apagar Lead.
7. `score` é integer 0–100 no próprio Lead (D4) — sem entidade aparte.

#### Campos sugeridos
| Campo | Tipo sugerido | Notas |
|---|---|---|
| `id` | uuid | PK |
| `company_id` | uuid | Tenant |
| `owner_id` | uuid? | User responsável |
| `name` | string? | |
| `phone` | string | E.164; único por Company |
| `email` | string? | |
| `source` | string/enum | ex.: `whatsapp`, `manual`, `import` |
| `status` | enum | `NEW`…`LOST` (D1) |
| `score` | int | 0–100 (D4); default 0 |
| `last_contact_at` | datetime? | |
| `last_inbound_at` | datetime? | |
| `last_outbound_at` | datetime? | |
| `external_id` | string? | id no provedor/canal |
| `metadata` | json? | dados extras não estruturados |
| `created_at` / `updated_at` / `deleted_at` | datetime | |

---

### 5.5 Conversation

#### Objetivo
Organizar o histórico de comunicação com um Lead em um canal.

#### Descrição
Aggregate root que contém Messages. No MVP, o canal principal é WhatsApp.

#### Responsabilidades
- Agrupar Messages
- Manter estado da thread (aberta/fechada/arquivada)
- Relacionar Lead + canal + identificadores externos
- Servir de contexto para IA e Follow-Up

#### Ciclo de vida
1. **Opened** — criada (primeira mensagem ou abertura manual)
2. **Active** — mensagens recentes
3. **Idle** — sem atividade (gatilho de recovery)
4. **Closed** / **Archived**
5. Soft-deleted

#### Estados possíveis
| Status | Significado |
|---|---|
| `open` | Ativa |
| `idle` | Sem interação recente |
| `closed` | Encerrada |
| `archived` | Arquivada |

#### Relacionamentos
- Conversation N:1 Company
- Conversation N:1 Lead
- Conversation 1:N Messages
- Conversation 0..N FollowUps (opcional)

#### Regras de negócio
1. Toda Conversation pertence a um Lead e a uma Company.
2. Messages **não** existem fora de Conversation.
3. Preferência MVP: **1 Conversation ativa por Lead+canal** (a confirmar).
4. Fechar Conversation não apaga Messages.
5. Webhooks WhatsApp devem ser idempotentes ao criar/atualizar Conversation/Message.

#### Campos sugeridos
| Campo | Tipo sugerido | Notas |
|---|---|---|
| `id` | uuid | PK |
| `company_id` | uuid | Tenant |
| `lead_id` | uuid | FK |
| `channel` | enum | `whatsapp` (extensível) |
| `status` | enum | `open`, `idle`, `closed`, `archived` |
| `external_thread_id` | string? | id Evolution/WhatsApp |
| `last_message_at` | datetime? | |
| `assigned_user_id` | uuid? | atendente |
| `created_at` / `updated_at` / `deleted_at` | datetime | |

---

### 5.6 Message

#### Objetivo
Registrar cada mensagem trocada na Conversation.

#### Descrição
Entidade interna do aggregate **Conversation**. Direção inbound/outbound; origem humana, sistema ou IA.

#### Responsabilidades
- Persistir conteúdo e metadados
- Garantir idempotência com ids externos
- Alimentar eventos (`message.received`, `message.sent`)
- Fornecer contexto à IA

#### Ciclo de vida
1. **Received / Queued** (inbound webhook ou outbound pendente)
2. **Sent / Delivered / Read** (se o canal informar)
3. **Failed** (falha de envio)
4. Soft-deleted (raro; preferir ocultar; hard delete proibido)

#### Estados possíveis
| Status | Significado |
|---|---|
| `pending` | Outbound aguardando envio |
| `sent` | Enviada ao provedor |
| `delivered` | Entregue (se disponível) |
| `read` | Lida (se disponível) |
| `failed` | Falha |
| `received` | Inbound persistida |

#### Relacionamentos
- Message N:1 Conversation
- Message N:1 Company (desnormalizado para tenant queries)
- Message → Lead (via Conversation)
- Message pode disparar Event

#### Regras de negócio
1. Message **sempre** referencia `conversation_id` + `company_id` (D9) — nunca isolada.
2. Idempotência por (`company_id`, `external_message_id`) quando houver id externo.
3. No MVP, outbound automático de Follow-Up só após aprovação humana (D3).
4. IA **não** pode apagar Messages.
5. Conteúdo sensível deve respeitar retenção/LGPD (política futura).

#### Campos sugeridos
| Campo | Tipo sugerido | Notas |
|---|---|---|
| `id` | uuid | PK |
| `company_id` | uuid | Tenant |
| `conversation_id` | uuid | Aggregate |
| `direction` | enum | `inbound`, `outbound` |
| `status` | enum | ver estados |
| `body` | text | conteúdo |
| `content_type` | enum | `text`, `image`, `audio`, `document`, … |
| `sender_type` | enum | `lead`, `user`, `system`, `ai` |
| `sender_user_id` | uuid? | se user |
| `external_message_id` | string? | idempotência |
| `sent_at` / `delivered_at` / `read_at` | datetime? | |
| `metadata` | json? | payload canal |
| `created_at` / `updated_at` / `deleted_at` | datetime | |

---

### 5.7 FollowUp

#### Objetivo
Garantir recontato tempestivo para leads em risco de perda.

#### Descrição
Unidade de trabalho de recuperação/acompanhamento.

**Modelo MVP (D3) — HÍBRIDO:**
1. Sistema **sugere** (regra e/ou IA)
2. Usuário **aprova**
3. Sistema **envia**

Modo fully-automatic: fora do MVP. Recovery Campaign: V2 (D5).

#### Responsabilidades
- Guardar sugestão e conteúdo proposto
- Registrar aprovação do usuário
- Executar envio após aprovação
- Relacionar Lead e, opcionalmente, Conversation/Message gerada
- Emitir Events (`follow_up.suggested`, `follow_up.approved`, `follow_up.executed`, …)

#### Ciclo de vida (híbrido)
1. **Suggested** — criado pelo sistema
2. **Approved** / **Rejected** — decisão humana
3. **Scheduled** / **Executing** — pós-aprovação
4. **Executed** / **Failed** / **Cancelled** / **Skipped**
5. Soft-deleted

#### Estados possíveis
| Status | Significado |
|---|---|
| `suggested` | Sugestão aguardando aprovação |
| `approved` | Usuário aprovou |
| `rejected` | Usuário rejeitou |
| `scheduled` | Agendado para envio |
| `executing` | Em processamento de envio |
| `executed` | Enviado/concluído |
| `failed` | Falhou |
| `cancelled` | Cancelado |
| `skipped` | Ignorado (ex.: lead já respondeu) |

#### Relacionamentos
- FollowUp N:1 Company
- FollowUp N:1 Lead
- FollowUp N:0..1 Conversation
- FollowUp N:0..1 Message (mensagem gerada)
- FollowUp N:0..1 User (`approved_by` / `assigned_to`)

#### Regras de negócio
1. Follow-Up sempre tem Lead + Company.
2. No MVP, **envio só após aprovação humana** (D3).
3. Regras de “quando sugerir” vivem no **backend**, não no n8n.
4. IA pode sugerir texto/horário; não envia sozinha no MVP.
5. Não existe entidade Recovery Campaign no MVP (D5).

#### Campos sugeridos
| Campo | Tipo sugerido | Notas |
|---|---|---|
| `id` | uuid | PK |
| `company_id` | uuid | Tenant |
| `lead_id` | uuid | FK |
| `conversation_id` | uuid? | |
| `assigned_user_id` | uuid? | |
| `approved_by` | uuid? | User que aprovou |
| `approved_at` | datetime? | |
| `channel` | enum | `whatsapp` (MVP) |
| `status` | enum | ver estados híbridos |
| `type` | enum | `reminder`, `recovery`, `nurture` |
| `scheduled_at` | datetime? | |
| `executed_at` | datetime? | |
| `suggested_body` | text? | conteúdo sugerido |
| `result_message_id` | uuid? | Message gerada |
| `cancel_reason` | string? | |
| `created_at` / `updated_at` / `deleted_at` | datetime | |

---

### 5.8 Event

#### Objetivo
Registrar fatos de domínio para orquestrar side-effects (follow-up, IA, integrações, métricas).

#### Descrição
Stream de ocorrências imutáveis. Diferente de AuditLog: Event é **fato de negócio/sistema** para reação; AuditLog é **trilha de responsabilidade**.

#### Responsabilidades
- Publicar o que aconteceu
- Permitir consumidores (Follow-Up, AI, Dashboard, n8n via backend)
- Suportar idempotência / reprocessamento controlado

#### Ciclo de vida
1. **Emitted** (persistido)
2. **Processed** / **Failed** (por consumidor — pode ser outbox/inbox futuro)
3. Nunca “editado”; correções = novos eventos

#### Estados possíveis
| Status | Significado |
|---|---|
| `pending` | Emitido, aguardando processamento |
| `processed` | Consumido com sucesso |
| `failed` | Falha de processamento |

> Em arquitetura outbox pura, o Event em si pode ser só append-only e o status viver em tabela de processamento — decisão pendente.

#### Relacionamentos
- Event N:1 Company (quando aplicável)
- Event referencia `aggregate_type` + `aggregate_id`
- Event pode ter `actor_user_id` opcional

#### Regras de negócio
1. Ações importantes **devem** gerar Event.
2. Eventos são imutáveis.
3. Consumidores são idempotentes.
4. Catálogo inicial sugerido (não exaustivo):
   - `company.created`
   - `user.joined_company`
   - `lead.created` / `lead.status_changed`
   - `message.received` / `message.sent`
   - `conversation.opened` / `conversation.idle`
   - `follow_up.scheduled` / `follow_up.executed` / `follow_up.skipped`
   - `ai.suggestion_created`

#### Campos sugeridos
| Campo | Tipo sugerido | Notas |
|---|---|---|
| `id` | uuid | PK |
| `company_id` | uuid? | null só se evento global |
| `type` | string | ex.: `message.received` |
| `aggregate_type` | string | `lead`, `conversation`, … |
| `aggregate_id` | uuid | |
| `payload` | json | dados do fato |
| `actor_user_id` | uuid? | |
| `correlation_id` | uuid? | rastreio |
| `occurred_at` | datetime | |
| `status` | enum | se processado na mesma tabela |
| `created_at` / `updated_at` / `deleted_at` | datetime | soft delete raro; preferir retenção |

---

### 5.9 AuditLog

#### Objetivo
Trilha de auditoria: quem fez o quê, quando, em qual Company.

#### Descrição
Registro append-only para conformidade, suporte e confiança. Complementa Event; não o substitui.

#### Responsabilidades
- Registrar ações importantes de usuários/sistema
- Preservar before/after quando relevante
- Permitir investigação sem alterar histórico

#### Ciclo de vida
1. **Created** (único estado operacional)
2. Retido conforme política; soft delete excepcional

#### Estados possíveis
Não possui máquina de estados de negócio. É imutável após criação.

#### Relacionamentos
- AuditLog N:1 Company
- AuditLog N:0..1 User (`actor`)
- Referencia entidade alvo (`target_type`, `target_id`)

#### Regras de negócio
1. Ações importantes geram AuditLog (e tipicamente também Event).
2. AuditLog não é editável.
3. IA não grava auditoria “como humano”; `actor_type` distingue `user` / `system` / `ai`.
4. Acesso a AuditLogs restrito a roles elevados (`owner`/`admin`).

#### Campos sugeridos
| Campo | Tipo sugerido | Notas |
|---|---|---|
| `id` | uuid | PK |
| `company_id` | uuid | Tenant |
| `actor_type` | enum | `user`, `system`, `ai` |
| `actor_user_id` | uuid? | |
| `action` | string | ex.: `lead.update`, `membership.revoke` |
| `target_type` | string | |
| `target_id` | uuid | |
| `before` | json? | snapshot |
| `after` | json? | snapshot |
| `ip` | string? | |
| `user_agent` | string? | |
| `occurred_at` | datetime | |
| `created_at` / `updated_at` / `deleted_at` | datetime | |

---

## 6. Mapa de relacionamentos (visão)

```text
User --------< Membership >-------- Company
                                     |
                 +-------------------+-------------------+
                 |                   |                   |
               Lead            Conversation          FollowUp
                 |                   |                   |
                 +--------< ---------+                   |
                                     |                   |
                                  Message <--------------+ (opcional result)
                                     |
                                   Event
                                   AuditLog
```

---

## 7. Regras transversais do domínio

1. **Multi-tenant:** isolamento por `company_id` em toda entidade de negócio.
2. **Soft delete:** obrigatório; proibido hard delete.
3. **Event + Audit:** ações importantes geram ambos (papéis distintos).
4. **Messages ⊂ Conversations:** sem bounded context/módulo separado de messages.
5. **IA não destrutiva:** não apaga registros, clientes, mensagens nem altera permissões.
6. **Backend dono da regra:** n8n só orquestra integrações.
7. **WhatsApp MVP:** Evolution API como provider inicial.
8. **Escopo fechado:** não modelar veículos, OS, estoque, financeiro.

---

## 8. Critérios de sucesso do domínio (produto)

O modelo está adequado ao MVP se permitir responder:

- Quais leads estão sem resposta?
- Quais follow-ups estão due?
- Qual o histórico da conversa?
- Quem fez o quê (auditoria)?
- O que aconteceu no sistema (eventos) para a IA/automações reagirem?

---

## 9. Próximo passo

Decisões D1–D10 estão congeladas em `domain-decisions.md`.

Ordem:

1. ✅ Domínio + decisões
2. ✅ Modelo relacional (`database-model.md` + `erd.md`)
3. ⏳ Aprovação do modelo relacional
4. ⏳ `schema.prisma` + migrations (**somente após aprovação explícita**)
