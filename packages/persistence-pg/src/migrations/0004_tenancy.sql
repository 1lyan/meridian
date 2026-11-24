-- Row-level security is the backstop for request and consumer transactions.
-- The relay and the reservation sweeper stay on the table owner, which can see
-- every tenant. Superusers bypass RLS, so those transactions SET ROLE meridian_app.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meridian_app') THEN
    CREATE ROLE meridian_app NOLOGIN NOINHERIT;
  END IF;
END $$;

GRANT meridian_app TO CURRENT_USER;

ALTER TABLE inbox ADD COLUMN tenant_id uuid;
UPDATE inbox SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
ALTER TABLE inbox ALTER COLUMN tenant_id SET NOT NULL;

CREATE TABLE audit_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL,
  CONSTRAINT audit_log_actor_chk CHECK (length(actor_id) > 0 AND length(actor_id) <= 200),
  CONSTRAINT audit_log_action_chk CHECK (length(action) > 0)
);

CREATE INDEX audit_log_tenant_created_idx ON audit_log (tenant_id, created_at DESC);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'orders',
    'order_lines',
    'outbox',
    'idempotency_keys',
    'stock_items',
    'reservations',
    'journal_entries',
    'catalog_products',
    'inbox',
    'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO meridian_app',
      table_name
    );
  END LOOP;
END $$;

ALTER TABLE postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE postings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON postings
  USING (
    EXISTS (
      SELECT 1 FROM journal_entries
      WHERE journal_entries.id = postings.journal_id
        AND journal_entries.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM journal_entries
      WHERE journal_entries.id = postings.journal_id
        AND journal_entries.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON postings TO meridian_app;

GRANT USAGE ON SCHEMA public TO meridian_app;
