# Lead Workspace — Review

**Sprint:** Lead Workspace  
**App:** `apps/web`  
**Constraint:** sem alterações em `apps/api` — só endpoints existentes.  
**Data:** 2026-08-06

---

## Objetivo

Transformar `/leads/[leadId]` de formulário de edição em **centro operacional** do lead.

---

## Entregue

| Capacidade | Endpoints | UI |
|------------|-----------|-----|
| Notes | `GET/POST/DELETE /api/leads/:id/notes` | Aba Notas — criar, listar, excluir |
| Activities | `GET/POST .../activities` + `complete` / `cancel` | Aba Atividades |
| Timeline | `GET /api/leads/:id/timeline` | Aba Timeline |
| Assign owner | `POST .../assign` + `unassign` + `GET /memberships` | Card Responsável |
| Histórico de status | Timeline filtrada (`AUDIT_LEAD_STATUS_CHANGE` + `LEAD_CREATED`) | Sidebar na Visão geral |
| Últimas conversas | `GET /api/conversations?leadId=` | Painel na Visão geral |
| Próximos follow-ups | `GET /api/follow-ups?leadId=` | Painel (SUGGESTED/APPROVED/SCHEDULED) |
| Dados + status | `GET/PATCH /api/leads/:id` | Formulário na Visão geral |

---

## Layout

```
PageHeader (nome, telefone, status, atalhos)
KPI strip (score, último contato, origem)
Tabs: Visão geral | Timeline | Notas | Atividades

Visão geral
├── Coluna principal: editar lead · conversas · follow-ups
└── Coluna lateral: responsável · histórico de status · identificador
```

---

## Arquivos principais

- `apps/web/src/app/(app)/leads/[leadId]/page.tsx` — workspace
- `apps/web/src/features/leads/notes-api.ts`
- `apps/web/src/features/leads/activities-api.ts`
- `apps/web/src/features/leads/timeline-api.ts`
- `apps/web/src/features/leads/lead-assign-card.tsx`
- `apps/web/src/features/leads/lead-notes-panel.tsx`
- `apps/web/src/features/leads/lead-activities-panel.tsx`
- `apps/web/src/features/leads/lead-timeline-panel.tsx`
- `apps/web/src/features/leads/lead-status-history.tsx`
- `apps/web/src/features/leads/lead-related-panels.tsx`
- `apps/web/src/lib/api/endpoints.ts` + `types.ts` — contratos

---

## UX / produto

- Copy em português (sem paths de API)
- Empty / loading / error nos painéis
- Confirmação ao excluir nota, cancelar atividade, remover responsável
- Unassign restrito a OWNER/ADMIN (espelha API)
- Invalidate de timeline ao mutar notas/atividades/status/assign

---

## Como validar

```bash
cd apps/web && PORT=3000 npm run dev
# API em :3001
```

1. Abrir um lead existente  
2. Atribuir responsável  
3. Criar nota e atividade (concluir/cancelar)  
4. Ver Timeline e Histórico de status após mudar status  
5. Conferir conversas e follow-ups filtrados pelo lead  

---

## Fora do escopo

- Novos endpoints  
- Soft delete de lead / bulk-assign  
- AI suggest  
- Board Kanban  

---

## Resultado

O detalhe do lead deixa de ser só um form e passa a ser o **hub operacional** do contato — com contexto, histórico e próximos passos na mesma tela.
