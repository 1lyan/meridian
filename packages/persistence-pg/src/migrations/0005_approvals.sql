-- Approvals are the only write the agent can ask for. Executing one
-- places an order through the same path a person uses. Agent runs are the
-- record of a tool loop; Mongo projects them and a rebuild copies them back.

CREATE TABLE approvals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  status text NOT NULL,
  currency text NOT NULL,
  lines jsonb NOT NULL,
  proposed_by text NOT NULL,
  decided_by text,
  order_id uuid,
  version integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT approvals_status_chk CHECK (status IN ('proposed', 'approved', 'rejected', 'executed')),
  CONSTRAINT approvals_currency_chk CHECK (currency = 'USD'),
  CONSTRAINT approvals_version_chk CHECK (version > 0)
);

CREATE INDEX approvals_tenant_created_idx ON approvals (tenant_id, created_at DESC);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  prompt_version text NOT NULL,
  status text NOT NULL,
  request text NOT NULL,
  transcript jsonb NOT NULL,
  blocked_reason text,
  approval_id uuid,
  created_at timestamptz NOT NULL,
  CONSTRAINT agent_runs_status_chk CHECK (status IN ('completed', 'blocked')),
  CONSTRAINT agent_runs_prompt_chk CHECK (length(prompt_version) > 0)
);

CREATE INDEX agent_runs_tenant_created_idx ON agent_runs (tenant_id, created_at DESC);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['approvals', 'agent_runs']
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
