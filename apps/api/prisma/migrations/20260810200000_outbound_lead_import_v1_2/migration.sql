-- Outbound V1.2 — Lead Import batches + RLS

CREATE TABLE "lead_import_batches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'UPLOADED',
    "input_kind" VARCHAR(16) NOT NULL,
    "filename" VARCHAR(255),
    "content_type" VARCHAR(120),
    "file_hash" VARCHAR(64),
    "byte_size" INTEGER,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "column_headers" JSONB NOT NULL DEFAULT '[]',
    "column_mapping" JSONB,
    "source_default" VARCHAR(32) NOT NULL DEFAULT 'OUTBOUND_IMPORT',
    "dedupe_mode" VARCHAR(16) NOT NULL DEFAULT 'skip',
    "staged_data" JSONB NOT NULL,
    "preview_sample" JSONB NOT NULL DEFAULT '[]',
    "report" JSONB,
    "error_message" VARCHAR(1000),
    "committed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "lead_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_import_batches_company_id_status_idx"
  ON "lead_import_batches"("company_id", "status");

CREATE INDEX "lead_import_batches_company_id_created_at_idx"
  ON "lead_import_batches"("company_id", "created_at");

CREATE INDEX "lead_import_batches_company_id_file_hash_idx"
  ON "lead_import_batches"("company_id", "file_hash");

ALTER TABLE "lead_import_batches"
  ADD CONSTRAINT "lead_import_batches_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lead_import_batches"
  ADD CONSTRAINT "lead_import_batches_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lead_import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_import_batches" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "lead_import_batches"
  FOR ALL
  USING (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id())
  WITH CHECK (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id());
