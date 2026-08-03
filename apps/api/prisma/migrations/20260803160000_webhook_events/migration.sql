-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM (
  'RECEIVED',
  'PROCESSED',
  'FAILED',
  'IGNORED',
  'DUPLICATE'
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "external_event_id" VARCHAR(191),
    "event_type" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" VARCHAR(1000),
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_events_company_id_received_at_idx"
ON "webhook_events"("company_id", "received_at");

-- CreateIndex
CREATE INDEX "webhook_events_company_id_status_idx"
ON "webhook_events"("company_id", "status");

-- CreateIndex
CREATE INDEX "webhook_events_instance_id_received_at_idx"
ON "webhook_events"("instance_id", "received_at");

-- CreateIndex
CREATE INDEX "webhook_events_company_id_external_event_id_idx"
ON "webhook_events"("company_id", "external_event_id");

-- Partial unique: idempotency by external_event_id when present (P2-W1)
CREATE UNIQUE INDEX "uq_webhook_events_company_external_active"
ON "webhook_events" ("company_id", "external_event_id")
WHERE "external_event_id" IS NOT NULL AND "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "webhook_events"
ADD CONSTRAINT "webhook_events_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "webhook_events"
ADD CONSTRAINT "webhook_events_instance_id_fkey"
FOREIGN KEY ("instance_id") REFERENCES "whatsapp_instances"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
