-- Fase 11D — Recovery Engine policy per company + RLS

CREATE TABLE "company_recovery_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "cooldown_hours" INTEGER NOT NULL DEFAULT 24,
    "stop_on_reply" BOOLEAN NOT NULL DEFAULT true,
    "stop_on_human_takeover" BOOLEAN NOT NULL DEFAULT true,
    "cadence_hours" INTEGER[] NOT NULL DEFAULT ARRAY[24, 72, 168]::INTEGER[],
    "allowed_hours_start" INTEGER,
    "allowed_hours_end" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "company_recovery_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_recovery_settings_company_id_key"
  ON "company_recovery_settings"("company_id");

ALTER TABLE "company_recovery_settings"
  ADD CONSTRAINT "company_recovery_settings_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_recovery_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_recovery_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "company_recovery_settings"
  FOR ALL
  USING (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id())
  WITH CHECK (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id());
