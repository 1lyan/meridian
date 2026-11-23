-- Phase 1 state machine. Statuses are added here, not by editing 0001.
ALTER TABLE orders DROP CONSTRAINT orders_status_chk;
ALTER TABLE orders ADD CONSTRAINT orders_status_chk
  CHECK (status IN ('placed', 'reserved', 'allocated', 'rejected'));

ALTER TABLE orders ADD COLUMN payment_outcome text NOT NULL DEFAULT 'capture';
ALTER TABLE orders ADD CONSTRAINT orders_payment_outcome_chk
  CHECK (payment_outcome IN ('capture', 'decline'));

ALTER TABLE orders ADD COLUMN rejection_reason text;
ALTER TABLE orders ADD CONSTRAINT orders_rejection_reason_chk
  CHECK (
    rejection_reason IS NULL
    OR rejection_reason IN ('insufficient_stock', 'payment_declined', 'reservation_timeout')
  );

CREATE TABLE stock_items (
  tenant_id uuid NOT NULL,
  sku text NOT NULL,
  warehouse_id uuid NOT NULL,
  on_hand integer NOT NULL,
  reserved integer NOT NULL,
  version integer NOT NULL,
  PRIMARY KEY (tenant_id, sku, warehouse_id),
  CONSTRAINT stock_on_hand_chk CHECK (on_hand >= 0),
  CONSTRAINT stock_reserved_chk CHECK (reserved >= 0 AND reserved <= on_hand),
  CONSTRAINT stock_version_chk CHECK (version >= 0)
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  sku text NOT NULL,
  warehouse_id uuid NOT NULL,
  quantity integer NOT NULL,
  status text NOT NULL,
  CONSTRAINT reservations_quantity_chk CHECK (quantity > 0),
  CONSTRAINT reservations_status_chk CHECK (status IN ('held', 'released')),
  CONSTRAINT reservations_order_sku_uniq UNIQUE (tenant_id, order_id, sku)
);

CREATE TABLE inbox (
  consumer text NOT NULL,
  message_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, message_id)
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT journal_entries_order_uniq UNIQUE (tenant_id, order_id)
);

CREATE TABLE postings (
  id uuid PRIMARY KEY,
  journal_id uuid NOT NULL REFERENCES journal_entries (id),
  account text NOT NULL,
  amount_cents integer NOT NULL,
  CONSTRAINT postings_account_chk CHECK (length(account) > 0)
);

CREATE OR REPLACE FUNCTION meridian_journal_balanced() RETURNS trigger AS $$
DECLARE
  total integer;
BEGIN
  SELECT coalesce(sum(amount_cents), 0) INTO total
  FROM postings
  WHERE journal_id = NEW.journal_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'unbalanced journal %', NEW.journal_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER postings_balanced
AFTER INSERT ON postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION meridian_journal_balanced();
