# ERD Textual — AutoPilot MVP

**Status:** Proposta (espelha `database-model.md`)  
**Formato:** ASCII + Mermaid  
**Sem schema Prisma / migrations nesta etapa.**

---

## 1. Diagrama ASCII

```text
┌──────────────────────┐         ┌──────────────────────┐
│       users          │         │      companies       │
│──────────────────────│         │──────────────────────│
│ id PK                │         │ id PK                │
│ email UK*            │         │ name                 │
│ name                 │         │ slug UK*             │
│ password_hash?       │         │ status               │
│ status               │         │ timezone             │
│ last_login_at?       │         │ plan?                │
│ created_at           │         │ created_at           │
│ updated_at           │         │ updated_at           │
│ deleted_at?          │         │ deleted_at?          │
└──────────▲───────────┘         └──────────▲───────────┘
           │                                 │
           │         ┌───────────────────────┤
           │         │                       │
           │  ┌──────┴───────────────┐       │
           └──┤    memberships       │───────┘
              │──────────────────────│
              │ id PK                │
              │ company_id FK        │
              │ user_id FK           │
              │ role (OWNER|ADMIN|   │
              │       AGENT)         │
              │ status               │
              │ invited_by? FK       │
              │ joined_at?           │
              │ created_at           │
              │ updated_at           │
              │ deleted_at?          │
              │ UK*(company_id,      │
              │     user_id)         │
              └──────────────────────┘


┌──────────────────────┐
│        leads         │
│──────────────────────│
│ id PK                │
│ company_id FK ───────┼──► companies
│ owner_id? FK ────────┼──► users
│ name?                │
│ phone  UK*(company,  │
│        phone)        │
│ email?               │
│ source               │
│ status (NEW|…|LOST)  │
│ score (0..100)       │
│ last_contact_at?     │
│ last_inbound_at?     │
│ last_outbound_at?    │
│ external_id?         │
│ metadata?            │
│ created_at           │
│ updated_at           │
│ deleted_at?          │
└──────────▲───────────┘
           │
           │ 1:N
           │
┌──────────┴───────────┐
│    conversations     │
│──────────────────────│
│ id PK                │
│ company_id FK ───────┼──► companies
│ lead_id FK           │
│ channel (WHATSAPP)   │
│ status               │
│ external_thread_id?  │
│ last_message_at?     │
│ assigned_user_id? FK─┼──► users
│ created_at           │
│ updated_at           │
│ deleted_at?          │
└──────────▲───────────┘
           │
           │ 1:N  (obrigatório — Message ⊂ Conversation)
           │
┌──────────┴───────────┐
│      messages        │
│──────────────────────│
│ id PK                │
│ company_id FK ───────┼──► companies
│ conversation_id FK   │  NOT NULL
│ direction            │
│ status               │
│ body?                │
│ content_type         │
│ sender_type          │
│ sender_user_id? FK ──┼──► users
│ external_message_id? │  UK*(company, external_message_id)
│ sent_at?             │
│ delivered_at?        │
│ read_at?             │
│ metadata?            │
│ created_at           │
│ updated_at           │
│ deleted_at?          │
└──────────▲───────────┘
           │
           │ 0..1 (result_message)
           │
┌──────────┴───────────┐
│     follow_ups       │
│──────────────────────│
│ id PK                │
│ company_id FK ───────┼──► companies
│ lead_id FK ──────────┼──► leads
│ conversation_id? FK ─┼──► conversations
│ assigned_user_id? FK─┼──► users
│ approved_by? FK ─────┼──► users
│ approved_at?         │
│ channel              │
│ status (híbrido D3)  │
│ type                 │
│ scheduled_at?        │
│ executed_at?         │
│ suggested_body?      │
│ result_message_id? FK┼──► messages
│ cancel_reason?       │
│ created_at           │
│ updated_at           │
│ deleted_at?          │
└──────────────────────┘


┌──────────────────────┐       ┌──────────────────────┐
│       events         │       │     audit_logs       │
│──────────────────────│       │──────────────────────│
│ id PK                │       │ id PK                │
│ company_id? FK ──────┼──►    │ company_id FK ───────┼──► companies
│ type                 │ co.   │ actor_type           │
│ aggregate_type       │       │ actor_user_id? FK ───┼──► users
│ aggregate_id         │       │ action               │
│ payload              │       │ target_type          │
│ actor_user_id? FK ───┼──►u   │ target_id            │
│ correlation_id?      │       │ before? / after?     │
│ occurred_at          │       │ ip? / user_agent?    │
│ status               │       │ occurred_at          │
│ created_at           │       │ created_at           │
│ updated_at           │       │ updated_at           │
│ deleted_at?          │       │ deleted_at?          │
└──────────────────────┘       └──────────────────────┘

UK* = unique parcial WHERE deleted_at IS NULL
```

---

## 2. Diagrama Mermaid

```mermaid
erDiagram
  COMPANIES ||--o{ MEMBERSHIPS : has
  USERS ||--o{ MEMBERSHIPS : has
  COMPANIES ||--o{ LEADS : owns
  USERS ||--o{ LEADS : owns_optional
  COMPANIES ||--o{ CONVERSATIONS : owns
  LEADS ||--o{ CONVERSATIONS : has
  CONVERSATIONS ||--o{ MESSAGES : contains
  COMPANIES ||--o{ MESSAGES : owns
  COMPANIES ||--o{ FOLLOW_UPS : owns
  LEADS ||--o{ FOLLOW_UPS : targets
  CONVERSATIONS ||--o{ FOLLOW_UPS : optional
  MESSAGES ||--o| FOLLOW_UPS : result_optional
  COMPANIES ||--o{ EVENTS : owns_optional
  COMPANIES ||--o{ AUDIT_LOGS : owns
  USERS ||--o{ AUDIT_LOGS : acts_optional

  COMPANIES {
    uuid id PK
    string name
    string slug
    string status
    string timezone
    string plan
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }

  USERS {
    uuid id PK
    string email
    string name
    string password_hash
    string status
    timestamptz last_login_at
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }

  MEMBERSHIPS {
    uuid id PK
    uuid company_id FK
    uuid user_id FK
    string role
    string status
    uuid invited_by FK
    timestamptz joined_at
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }

  LEADS {
    uuid id PK
    uuid company_id FK
    uuid owner_id FK
    string name
    string phone
    string email
    string source
    string status
    int score
    timestamptz last_contact_at
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }

  CONVERSATIONS {
    uuid id PK
    uuid company_id FK
    uuid lead_id FK
    string channel
    string status
    string external_thread_id
    timestamptz last_message_at
    uuid assigned_user_id FK
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }

  MESSAGES {
    uuid id PK
    uuid company_id FK
    uuid conversation_id FK
    string direction
    string status
    text body
    string content_type
    string sender_type
    uuid sender_user_id FK
    string external_message_id
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }

  FOLLOW_UPS {
    uuid id PK
    uuid company_id FK
    uuid lead_id FK
    uuid conversation_id FK
    uuid approved_by FK
    string status
    string type
    text suggested_body
    uuid result_message_id FK
    timestamptz scheduled_at
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }

  EVENTS {
    uuid id PK
    uuid company_id FK
    string type
    string aggregate_type
    uuid aggregate_id
    jsonb payload
    string status
    timestamptz occurred_at
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }

  AUDIT_LOGS {
    uuid id PK
    uuid company_id FK
    string actor_type
    uuid actor_user_id FK
    string action
    string target_type
    uuid target_id
    jsonb before
    jsonb after
    timestamptz occurred_at
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }
```

---

## 3. Cardinalidades-chave

| Relação | Cardinalidade | Regra |
|---|---|---|
| User ↔ Company | N:N via Membership | Membership obrigatória para acesso |
| Company → Lead | 1:N | phone único por company |
| Lead → Conversation | 1:N | |
| Conversation → Message | 1:N | Message nunca órfã |
| Lead → FollowUp | 1:N | híbrido: approve antes de send |
| FollowUp → Message | 0..1 | resultado do envio |

---

## 4. Fora do ERD (MVP)

- `recovery_campaigns`
- `lead_scores` (score vive em `leads.score`)
- entidades de ERP / oficina / veículos / financeiro

---

## 5. Próximo passo

Após aprovação de `database-model.md` + este ERD:

→ gerar `prisma/schema.prisma` e migration inicial (**somente com autorização explícita**).
