-- CreateEnum
CREATE TYPE "WhatsAppConnectionStatus" AS ENUM (
  'QR_PENDING',
  'CONNECTING',
  'CONNECTED',
  'DISCONNECTED',
  'ERROR'
);

-- CreateTable
CREATE TABLE "whatsapp_instances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "instance_key" UUID NOT NULL,
    "evolution_instance_name" VARCHAR(100) NOT NULL,
    "evolution_instance_id" VARCHAR(191),
    "status" "WhatsAppConnectionStatus" NOT NULL,
    "phone_number" VARCHAR(32),
    "webhook_secret_hash" VARCHAR(255) NOT NULL,
    "qr_code" TEXT,
    "qr_expires_at" TIMESTAMPTZ(6),
    "connected_at" TIMESTAMPTZ(6),
    "last_disconnected_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(1000),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "whatsapp_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_instances_instance_key_key" ON "whatsapp_instances"("instance_key");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_instances_evolution_instance_name_key" ON "whatsapp_instances"("evolution_instance_name");

-- CreateIndex
CREATE INDEX "whatsapp_instances_company_id_idx" ON "whatsapp_instances"("company_id");

-- CreateIndex
CREATE INDEX "whatsapp_instances_status_idx" ON "whatsapp_instances"("status");

-- Partial unique: 1 active instance per company (D1)
CREATE UNIQUE INDEX "uq_whatsapp_instances_company_active"
ON "whatsapp_instances" ("company_id")
WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "whatsapp_instances"
ADD CONSTRAINT "whatsapp_instances_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
