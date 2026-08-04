-- Fase 9 — CRM Operations: LeadNote, LeadActivity, LeadStatusTransition + RLS

CREATE TYPE "LeadActivityType" AS ENUM ('CALL', 'MEETING', 'EMAIL', 'VISIT', 'OTHER');
CREATE TYPE "LeadActivityStatus" AS ENUM ('PLANNED', 'DONE', 'CANCELLED');

CREATE TABLE "lead_notes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "user_id" UUID,
    "type" "LeadActivityType" NOT NULL,
    "status" "LeadActivityStatus" NOT NULL DEFAULT 'PLANNED',
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT,
    "scheduled_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_status_transitions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "from_status" "LeadStatus",
    "to_status" "LeadStatus" NOT NULL,
    "changed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_status_transitions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lead_status_transitions" ADD CONSTRAINT "lead_status_transitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_status_transitions" ADD CONSTRAINT "lead_status_transitions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_status_transitions" ADD CONSTRAINT "lead_status_transitions_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "lead_notes_company_id_lead_id_created_at_idx" ON "lead_notes"("company_id", "lead_id", "created_at");
CREATE INDEX "lead_notes_company_id_user_id_idx" ON "lead_notes"("company_id", "user_id");

CREATE INDEX "lead_activities_company_id_lead_id_scheduled_at_idx" ON "lead_activities"("company_id", "lead_id", "scheduled_at");
CREATE INDEX "lead_activities_company_id_status_scheduled_at_idx" ON "lead_activities"("company_id", "status", "scheduled_at");
CREATE INDEX "lead_activities_company_id_user_id_status_idx" ON "lead_activities"("company_id", "user_id", "status");

CREATE INDEX "lead_status_transitions_company_id_lead_id_created_at_idx" ON "lead_status_transitions"("company_id", "lead_id", "created_at");
CREATE INDEX "lead_status_transitions_company_id_to_status_created_at_idx" ON "lead_status_transitions"("company_id", "to_status", "created_at");

-- RLS (8B pattern): ENABLE+FORCE + tenant_isolation
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'lead_notes',
    'lead_activities',
    'lead_status_transitions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         FOR ALL
         USING (
           autopilot_rls_bypass()
           OR company_id = autopilot_rls_company_id()
         )
         WITH CHECK (
           autopilot_rls_bypass()
           OR company_id = autopilot_rls_company_id()
         )',
      t
    );
  END LOOP;
END $$;
