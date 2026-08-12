-- Outbound V1.4A — Campaign MVP + membership + RLS

CREATE TABLE "outbound_campaigns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "objective" VARCHAR(500) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    "started_at" TIMESTAMPTZ(6),
    "paused_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbound_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbound_campaigns_company_id_status_idx"
  ON "outbound_campaigns"("company_id", "status");

CREATE INDEX "outbound_campaigns_company_id_created_at_idx"
  ON "outbound_campaigns"("company_id", "created_at");

ALTER TABLE "outbound_campaigns"
  ADD CONSTRAINT "outbound_campaigns_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outbound_campaigns"
  ADD CONSTRAINT "outbound_campaigns_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "outbound_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbound_campaigns" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "outbound_campaigns"
  FOR ALL
  USING (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id())
  WITH CHECK (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id());

CREATE TABLE "outbound_campaign_leads" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbound_campaign_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbound_campaign_leads_campaign_id_lead_id_key"
  ON "outbound_campaign_leads"("campaign_id", "lead_id");

CREATE INDEX "outbound_campaign_leads_company_id_campaign_id_idx"
  ON "outbound_campaign_leads"("company_id", "campaign_id");

CREATE INDEX "outbound_campaign_leads_company_id_lead_id_idx"
  ON "outbound_campaign_leads"("company_id", "lead_id");

ALTER TABLE "outbound_campaign_leads"
  ADD CONSTRAINT "outbound_campaign_leads_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outbound_campaign_leads"
  ADD CONSTRAINT "outbound_campaign_leads_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "outbound_campaigns"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outbound_campaign_leads"
  ADD CONSTRAINT "outbound_campaign_leads_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outbound_campaign_leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbound_campaign_leads" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "outbound_campaign_leads"
  FOR ALL
  USING (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id())
  WITH CHECK (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id());
