-- Orders are the system of record. The outbox row commits in the same transaction
-- as the order, so a crash cannot leave a placed order that was never announced.
-- published_at stays null until the phase 1 relay confirms the broker accepted it.
-- Later statuses are added by a new migration; this check is the phase 0 state machine.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  status text NOT NULL,
  currency text NOT NULL,
  version integer NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT orders_id_tenant_uniq UNIQUE (id, tenant_id),
  CONSTRAINT orders_status_chk CHECK (status = 'placed'),
  CONSTRAINT orders_currency_chk CHECK (currency = 'USD'),
  CONSTRAINT orders_version_chk CHECK (version >= 1)
);

CREATE INDEX orders_tenant_created_idx ON orders (tenant_id, created_at DESC);

CREATE TABLE order_lines (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  sku text NOT NULL,
  quantity integer NOT NULL,
  unit_price_cents integer NOT NULL,
  CONSTRAINT order_lines_order_fk
    FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id),
  CONSTRAINT order_lines_order_sku_uniq UNIQUE (order_id, sku),
  CONSTRAINT order_lines_sku_chk CHECK (length(btrim(sku)) > 0 AND length(sku) <= 64),
  CONSTRAINT order_lines_quantity_chk CHECK (quantity > 0),
  CONSTRAINT order_lines_price_chk CHECK (unit_price_cents >= 0)
);

CREATE INDEX order_lines_tenant_idx ON order_lines (tenant_id);

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  CONSTRAINT outbox_type_chk CHECK (length(type) > 0),
  CONSTRAINT outbox_aggregate_type_chk CHECK (length(aggregate_type) > 0)
);

CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, key),
  CONSTRAINT idempotency_key_chk CHECK (length(key) > 0 AND length(key) <= 255),
  CONSTRAINT idempotency_hash_chk CHECK (length(request_hash) > 0)
);
