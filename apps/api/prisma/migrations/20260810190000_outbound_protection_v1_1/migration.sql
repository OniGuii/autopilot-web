-- Outbound V1.1 — Protection Layer (settings + suppress registry) + RLS

CREATE TABLE "company_outbound_protection_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "daily_proactive_cap" INTEGER NOT NULL DEFAULT 50,
    "hourly_proactive_cap" INTEGER NOT NULL DEFAULT 15,
    "lead_cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "min_spacing_seconds" INTEGER NOT NULL DEFAULT 30,
    "allowed_hours_start" INTEGER,
    "allowed_hours_end" INTEGER,
    "suppress_on_keywords" TEXT[] NOT NULL DEFAULT ARRAY['pare', 'stop', 'sair', 'cancelar']::TEXT[],
    "auto_suppress_on_lost" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "company_outbound_protection_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_outbound_protection_settings_company_id_key"
  ON "company_outbound_protection_settings"("company_id");

ALTER TABLE "company_outbound_protection_settings"
  ADD CONSTRAINT "company_outbound_protection_settings_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_outbound_protection_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_outbound_protection_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "company_outbound_protection_settings"
  FOR ALL
  USING (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id())
  WITH CHECK (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id());

CREATE TABLE "outbound_suppress_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "lead_id" UUID,
    "reason" VARCHAR(500),
    "source" VARCHAR(32) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbound_suppress_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbound_suppress_entries_company_id_phone_key"
  ON "outbound_suppress_entries"("company_id", "phone");

CREATE INDEX "outbound_suppress_entries_company_id_active_idx"
  ON "outbound_suppress_entries"("company_id", "active");

CREATE INDEX "outbound_suppress_entries_company_id_lead_id_idx"
  ON "outbound_suppress_entries"("company_id", "lead_id");

ALTER TABLE "outbound_suppress_entries"
  ADD CONSTRAINT "outbound_suppress_entries_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outbound_suppress_entries"
  ADD CONSTRAINT "outbound_suppress_entries_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "outbound_suppress_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbound_suppress_entries" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "outbound_suppress_entries"
  FOR ALL
  USING (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id())
  WITH CHECK (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id());
