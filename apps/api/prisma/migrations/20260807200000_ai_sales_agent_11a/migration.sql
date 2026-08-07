-- Fase 11A — AI Sales Agent: settings + knowledge base + enums + RLS

CREATE TYPE "AiAgentMode" AS ENUM ('OFF', 'ASSIST', 'AUTO');
CREATE TYPE "KnowledgeBaseKind" AS ENUM ('FAQ', 'PRODUCT', 'PRICE', 'PAYMENT', 'DELIVERY', 'HOURS', 'ADDRESS');
CREATE TYPE "AiIntent" AS ENUM ('PRICE', 'PRODUCT', 'PAYMENT', 'DELIVERY', 'COMPLAINT', 'HUMAN', 'UNKNOWN');

CREATE TABLE "company_ai_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "mode" "AiAgentMode" NOT NULL DEFAULT 'ASSIST',
    "max_auto_replies_per_lead_day" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "company_ai_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_ai_settings_company_id_key" ON "company_ai_settings"("company_id");

ALTER TABLE "company_ai_settings"
  ADD CONSTRAINT "company_ai_settings_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "knowledge_base_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "KnowledgeBaseKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(8000) NOT NULL,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "knowledge_base_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_base_entries_company_id_kind_idx"
  ON "knowledge_base_entries"("company_id", "kind");
CREATE INDEX "knowledge_base_entries_company_id_active_idx"
  ON "knowledge_base_entries"("company_id", "active");
CREATE INDEX "knowledge_base_entries_company_id_sort_order_idx"
  ON "knowledge_base_entries"("company_id", "sort_order");

ALTER TABLE "knowledge_base_entries"
  ADD CONSTRAINT "knowledge_base_entries_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (same pattern as CRM ops tables)
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'company_ai_settings',
    'knowledge_base_entries'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         FOR ALL
         USING (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id())
         WITH CHECK (autopilot_rls_bypass() OR company_id = autopilot_rls_company_id())',
      t
    );
  END LOOP;
END $$;
