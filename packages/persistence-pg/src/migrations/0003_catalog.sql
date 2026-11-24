-- Catalog rows are the source for Mongo catalog documents and for pgvector search.
-- The embedding width matches embeddingDimensions in @meridian/domain-catalog.
CREATE TABLE catalog_products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  sku text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  unit_price_cents integer NOT NULL,
  embedding vector(32) NOT NULL,
  CONSTRAINT catalog_products_tenant_sku_uniq UNIQUE (tenant_id, sku),
  CONSTRAINT catalog_products_sku_chk CHECK (length(btrim(sku)) > 0 AND length(sku) <= 64),
  CONSTRAINT catalog_products_name_chk CHECK (length(btrim(name)) > 0 AND length(name) <= 200),
  CONSTRAINT catalog_products_description_chk CHECK (
    length(btrim(description)) > 0 AND length(description) <= 2000
  ),
  CONSTRAINT catalog_products_price_chk CHECK (unit_price_cents >= 0)
);

CREATE INDEX catalog_products_tenant_idx ON catalog_products (tenant_id);

CREATE INDEX catalog_products_keywords_idx
  ON catalog_products
  USING gin (to_tsvector('simple', name || ' ' || description));

CREATE INDEX catalog_products_embedding_idx
  ON catalog_products
  USING hnsw (embedding vector_cosine_ops);
