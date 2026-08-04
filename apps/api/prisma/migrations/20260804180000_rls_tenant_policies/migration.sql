-- Fase 8B — PostgreSQL RLS (defense in depth).
-- Tenant Extension (app) remains active; RLS enforces company_id at DB layer.
-- Session GUC: app.company_id (UUID text), app.rls_bypass ('on'|'off').
-- Admin bypass: SET app.rls_bypass = 'on' (migrations/seeds/system scanners).

CREATE OR REPLACE FUNCTION autopilot_rls_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION autopilot_rls_bypass()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.rls_bypass', true), 'off') = 'on';
$$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'leads',
    'conversations',
    'messages',
    'follow_ups',
    'events',
    'audit_logs',
    'webhook_events'
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

-- whatsapp_instances: SELECT open for webhook bootstrap by instanceKey
-- (secret still verified in app). Writes remain tenant-scoped.
ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_instances FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_instances_select ON whatsapp_instances;
DROP POLICY IF EXISTS whatsapp_instances_write ON whatsapp_instances;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_instances;

CREATE POLICY whatsapp_instances_select ON whatsapp_instances
  FOR SELECT
  USING (true);

CREATE POLICY whatsapp_instances_insert ON whatsapp_instances
  FOR INSERT
  WITH CHECK (
    autopilot_rls_bypass()
    OR company_id = autopilot_rls_company_id()
  );

CREATE POLICY whatsapp_instances_update ON whatsapp_instances
  FOR UPDATE
  USING (
    autopilot_rls_bypass()
    OR company_id = autopilot_rls_company_id()
  )
  WITH CHECK (
    autopilot_rls_bypass()
    OR company_id = autopilot_rls_company_id()
  );

CREATE POLICY whatsapp_instances_delete ON whatsapp_instances
  FOR DELETE
  USING (
    autopilot_rls_bypass()
    OR company_id = autopilot_rls_company_id()
  );

COMMENT ON FUNCTION autopilot_rls_company_id() IS
  '8B — reads SET LOCAL app.company_id for RLS policies';
COMMENT ON FUNCTION autopilot_rls_bypass() IS
  '8B — admin/system bypass when app.rls_bypass=on (migrate/seed/scanners)';
