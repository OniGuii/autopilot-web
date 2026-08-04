# Fase 9 — CRM Operations (Implementation Review)

**Status:** Implemented  
**Branch:** `cursor/crm-operations-impl-dd93`  
**Scope:** Notes, Activities, Timeline, Pipeline KPIs, Ownership (unassign + bulk-assign), LeadStatusTransition history  
**Out of scope:** Auth/WhatsApp/AI/Workers core, SLA runtime, frontend

---

## Implemented

| Area | Status |
|---|---|
| Prisma models `LeadNote`, `LeadActivity`, `LeadStatusTransition` + enums | Done |
| Migration `20260804190000_crm_operations` (tables, indexes, FORCE RLS) | Done |
| Tenant / soft-delete extension lists | Done (`leadStatusTransition` tenant-only; no soft delete) |
| Lead notes CRUD + soft delete 204 | Done |
| Lead activities CRUD + complete/cancel + status machine | Done |
| Lead create/update → `LeadStatusTransition` | Done |
| Status change audit `LEAD_STATUS_CHANGE` | Done |
| Unassign + bulk-assign (`ownerId: null` = mass unassign) | Done |
| Timeline composition + page/limit pagination | Done |
| `GET /api/pipeline` KPIs (partial metrics OK) | Done |
| Unit + e2e smoke | Done |

---

## Endpoints

| Method | Path | Roles | Notes |
|---|---|---|---|
| `POST/GET` | `/api/leads/:leadId/notes` | OWNER\|ADMIN\|AGENT | Create sets `userId=sub` |
| `GET/PATCH/DELETE` | `/api/leads/:leadId/notes/:id` | same; mutate author or OWNER/ADMIN | DELETE → 204 soft |
| `POST/GET` | `/api/leads/:leadId/activities` | OWNER\|ADMIN\|AGENT | |
| `GET/PATCH/DELETE` | `/api/leads/:leadId/activities/:id` | same | DONE/CANCELLED immutable |
| `POST` | `/api/leads/:leadId/activities/:id/complete` | same | → DONE + `completedAt` |
| `POST` | `/api/leads/:leadId/activities/:id/cancel` | same | → CANCELLED |
| `GET` | `/api/leads/:id/timeline?page&limit` | OWNER\|ADMIN\|AGENT | default page=1 limit=50 max=100; ASC |
| `POST` | `/api/leads/:id/unassign` | OWNER\|ADMIN | audit `LEAD_UNASSIGN` |
| `POST` | `/api/leads/bulk-assign` | OWNER\|ADMIN | before `:id` routes; AGENT → 403 |
| `GET` | `/api/pipeline` | OWNER\|ADMIN\|AGENT | operational funnel KPIs |

---

## Audit actions (exact)

- `NOTE_CREATE` \| `NOTE_UPDATE` \| `NOTE_DELETE`
- `ACTIVITY_CREATE` \| `ACTIVITY_UPDATE` \| `ACTIVITY_COMPLETE` \| `ACTIVITY_CANCEL`
- `LEAD_BULK_ASSIGN` \| `LEAD_UNASSIGN` \| `LEAD_STATUS_CHANGE`
- Per-lead in bulk: `LEAD_ASSIGN` or `LEAD_UNASSIGN` (+ summary `LEAD_BULK_ASSIGN`)

Soft-delete of activities uses `ACTIVITY_UPDATE` (no `ACTIVITY_DELETE` in approved set).

---

## Migrations / RLS

`apps/api/prisma/migrations/20260804190000_crm_operations/migration.sql`:

1. `CREATE TYPE` `LeadActivityType`, `LeadActivityStatus`
2. Tables `lead_notes`, `lead_activities`, `lead_status_transitions` + FKs + indexes
3. `ENABLE` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy using `autopilot_rls_bypass() OR company_id = autopilot_rls_company_id()` (same as 8B)

---

## Pipeline metrics

- `leadsByStage`, `leadsWithoutContact`, `leadsUnassigned` always computed
- `conversionByStage` / `avgTimeInStageMs` derived from `LeadStatusTransition`
- If no transitions: both returned as `null` (no error)

---

## Limitations (v1)

- Timeline merges sources in memory then paginates (OK for MVP; may need DB-side pagination later)
- Timeline audit fetch capped (`take: 2000`)
- Activity soft-delete has no dedicated audit action name
- Historical leads created before Fase 9 lack initial transition rows until next status change (create path writes transition going forward)
- SLA engine remains design-only
- No seed demo notes/activities required for CI

---

## Test surface

Unit: `lead-notes.service.spec.ts`, `lead-activities.service.spec.ts`, `leads.service.spec.ts`, `leads.controller.spec.ts`, `lead-timeline.service.spec.ts`, `pipeline.service.spec.ts`  
E2E: `test/crm-operations.e2e-spec.ts` (OWNER smoke + AGENT 403 on bulk-assign when agent fixture available)
