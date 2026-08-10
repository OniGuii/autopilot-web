-- Outbound V1.3 — First Touch Engine settings + RLS

CREATE TABLE "company_first_touch_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "mode" VARCHAR(32) NOT NULL DEFAULT 'OFF',
    "vertical_playbook" VARCHAR(32) NOT NULL DEFAULT 'generic',
    "max_batch_size" INTEGER NOT NULL DEFAULT 50,
    "require_import_batch" BOOLEAN NOT NULL DEFAULT false,
    "enable_kb_grounding" BOOLEAN NOT NULL DEFAULT true,
    "enable_memory_seed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "company_first_touch_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_first_touch_settings_company_id_key"
  ON "company_first_touch_settings"("company_id");

ALTER TABLE "company_first_touch_settings"
  ADD CONSTRAINT "company_first_touch_settings_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_first_touch_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_first_touch_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "company_first_touch_settings"
  FOR ALL
  USING (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id())
  WITH CHECK (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id());
