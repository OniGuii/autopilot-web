-- Phase 3 outbound delivery fields on messages
-- status/sent_at/delivered_at/read_at already exist (String + timestamps).
-- Lead.last_outbound_at already exists from init_mvp.

ALTER TABLE "messages"
ADD COLUMN "failed_at" TIMESTAMPTZ(6),
ADD COLUMN "error_message" VARCHAR(1000);

CREATE INDEX "messages_company_id_direction_status_idx"
ON "messages" ("company_id", "direction", "status");
