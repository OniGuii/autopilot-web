-- Fase 8B — scale indexes for Dashboard / Ops / WhatsApp / AI / scanners.
-- Documented in apps/api/docs/rls-review.md

-- FollowUp due scanner (cross-tenant): status + scheduled_at for SCHEDULED due rows
CREATE INDEX IF NOT EXISTS "follow_ups_status_scheduled_at_due_idx"
  ON "follow_ups" ("status", "scheduled_at")
  WHERE "deleted_at" IS NULL AND "status" = 'SCHEDULED';

-- Ops / reconcile: stale EXECUTING follow-ups by updated_at
CREATE INDEX IF NOT EXISTS "follow_ups_status_updated_at_idx"
  ON "follow_ups" ("status", "updated_at")
  WHERE "deleted_at" IS NULL;

-- Ops: stale PENDING outbound messages
CREATE INDEX IF NOT EXISTS "messages_status_created_at_pending_idx"
  ON "messages" ("status", "created_at")
  WHERE "deleted_at" IS NULL AND "status" = 'PENDING';

-- AI suggest context: messages by conversation ordered by created_at (tenant-scoped path)
CREATE INDEX IF NOT EXISTS "messages_company_conversation_created_idx"
  ON "messages" ("company_id", "conversation_id", "created_at")
  WHERE "deleted_at" IS NULL;

-- Ops webhook stale RECEIVED
CREATE INDEX IF NOT EXISTS "webhook_events_status_received_at_idx"
  ON "webhook_events" ("status", "received_at")
  WHERE "deleted_at" IS NULL;

-- Dashboard lead KPIs filtered by soft-delete + created_at window
CREATE INDEX IF NOT EXISTS "leads_company_created_active_idx"
  ON "leads" ("company_id", "created_at")
  WHERE "deleted_at" IS NULL;
