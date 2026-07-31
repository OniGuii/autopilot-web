# Decisões de Domínio — AutoPilot MVP

**Status:** Congeladas  
**Data de congelamento:** 2026-07-31  
**Documentos relacionados:** `domain-model.md`, `domain-review.md`, `database-model.md`

Este arquivo registra as decisões oficiais do MVP.  
Qualquer alteração exige nova aprovação explícita.

---

## D1 — Estados do Lead

Estados oficiais (somente estes):

| Status | Definição |
|---|---|
| `NEW` | Lead recém-criado |
| `CONTACTED` | Primeiro contato realizado |
| `RESPONDED` | Cliente respondeu |
| `QUALIFIED` | Lead demonstrou interesse real |
| `CONVERTED` | Objetivo alcançado |
| `LOST` | Lead encerrado sem conversão |

**Não criar estados adicionais no MVP.**

---

## D2 — Significado de CONVERTED

No MVP, `CONVERTED` significa:

> **Objetivo comercial alcançado**

Não necessariamente venda concluída.

Exemplos válidos:
- agendamento de visita
- agendamento de avaliação
- solicitação de proposta
- solicitação de financiamento
- venda

O tipo exato de conversão será refinado no futuro (sem entidade extra no MVP).

---

## D3 — Follow-Up

**Modelo oficial: HÍBRIDO**

1. O sistema **sugere**
2. O usuário **aprova**
3. O sistema **envia**

Modo totalmente automático: **fora do MVP** (futuro).

---

## D4 — Lead Score

- **Não** criar entidade `LeadScore`
- Campo numérico em `Lead`: `score` (integer, 0–100)

---

## D5 — Recovery Campaign

- **Não** criar entidade no MVP
- Adiar para **V2**
- Conceito permanece no glossário de produto, sem persistência

---

## D6 — Deduplicação de Lead

Regra oficial:

- `phone` é **único dentro da Company**
- A mesma pessoa **pode** existir em Companies diferentes

Constraint alvo: unicidade de (`company_id`, `phone`) considerando soft delete (ver `database-model.md`).

---

## D7 — Roles

Roles oficiais do MVP (somente estas):

| Role | Definição |
|---|---|
| `OWNER` | Dono da operação |
| `ADMIN` | Gestor |
| `AGENT` | Vendedor / atendente |

**Nenhuma role adicional no MVP.**

---

## D8 — User e Company

Modelo oficial:

```text
User → Membership → Company
```

- `Membership` é **obrigatória** para acesso a dados da Company
- User **nunca** pertence diretamente à Company

---

## D9 — Message

- Message pertence **obrigatoriamente** a Conversation
- Nunca existe isoladamente
- Sem módulo/tabela desacoplada de Conversation no desenho de API

---

## D10 — Multi-tenancy

- Todas as entidades de negócio pertencem a `Company`
- **Exceção:** `User` (global)
- O vínculo User↔Company é exclusivamente via `Membership`

---

## Defaults adotados após congelamento

| Tema | Default MVP |
|---|---|
| Follow-Up automático total | Não |
| RecoveryCampaign table | Não |
| Lead Score entity | Não (campo apenas) |
| Roles extras | Não |
| Estados extras de Lead | Não |

---

## Próximo artefato

Com estas decisões + `domain-model.md`:

1. `database-model.md` — modelo relacional
2. `erd.md` — diagrama textual
3. *(futuro, após aprovação)* `schema.prisma` + migrations
