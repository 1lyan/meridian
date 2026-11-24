import { randomUUID } from 'node:crypto'
import { embeddingDimensions } from '@meridian/domain-catalog'
import { parseTenantId, type TenantId } from '@meridian/kernel'
import type { Pool } from 'pg'
import { appendOutbox } from './saga-store.js'

export type CatalogProductRecord = {
  id: string
  tenantId: string
  sku: string
  name: string
  description: string
  unitPriceCents: number
}

export type CatalogSearchHit = {
  sku: string
  name: string
  description: string
  unitPriceCents: number
  keywordRank: number
  similarity: number
}

export type StoredTimeline = {
  orderId: string
  status: string
  version: number
  rejectionReason: string | null
  events: { messageId: string; type: string; occurredAt: string }[]
}

export async function upsertCatalogProduct(
  pool: Pool,
  input: {
    tenantId: string
    sku: string
    name: string
    description: string
    unitPriceCents: number
    embedding: readonly number[]
  },
): Promise<CatalogProductRecord> {
  if (input.embedding.length !== embeddingDimensions) {
    throw new Error(
      `Embedding must have ${embeddingDimensions} dimensions, received ${input.embedding.length}`,
    )
  }
  const tenantId = parseTenantId(input.tenantId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const saved = await client.query<{ id: string }>(
      `INSERT INTO catalog_products
         (id, tenant_id, sku, name, description, unit_price_cents, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
       ON CONFLICT (tenant_id, sku) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         unit_price_cents = EXCLUDED.unit_price_cents,
         embedding = EXCLUDED.embedding
       RETURNING id`,
      [
        randomUUID(),
        tenantId,
        input.sku,
        input.name,
        input.description,
        input.unitPriceCents,
        vectorLiteral(input.embedding),
      ],
    )
    const id = saved.rows[0]?.id
    if (!id) throw new Error('Catalog upsert did not return an id')
    await appendOutbox(client, {
      tenantId,
      aggregateType: 'catalog',
      aggregateId: id,
      type: 'CatalogUpserted',
      payload: {
        type: 'CatalogUpserted',
        tenantId,
        sku: input.sku,
        productId: id,
      },
      headers: {},
    })
    await client.query('COMMIT')
    return {
      id,
      tenantId,
      sku: input.sku,
      name: input.name,
      description: input.description,
      unitPriceCents: input.unitPriceCents,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function loadCatalogProduct(
  pool: Pool,
  tenantId: string,
  sku: string,
): Promise<CatalogProductRecord | null> {
  const result = await pool.query<{
    id: string
    tenant_id: string
    sku: string
    name: string
    description: string
    unit_price_cents: number
  }>(
    `SELECT id, tenant_id, sku, name, description, unit_price_cents
     FROM catalog_products
     WHERE tenant_id = $1 AND sku = $2`,
    [parseTenantId(tenantId), sku],
  )
  const row = result.rows[0]
  if (!row) return null
  return toProduct(row)
}

export async function listCatalogProducts(
  pool: Pool,
  tenantId: TenantId,
): Promise<CatalogProductRecord[]> {
  const result = await pool.query<{
    id: string
    tenant_id: string
    sku: string
    name: string
    description: string
    unit_price_cents: number
  }>(
    `SELECT id, tenant_id, sku, name, description, unit_price_cents
     FROM catalog_products
     WHERE tenant_id = $1
     ORDER BY sku`,
    [tenantId],
  )
  return result.rows.map((row) => toProduct(row))
}

export async function searchCatalog(
  pool: Pool,
  input: {
    tenantId: string
    query: string
    embedding: readonly number[]
    limit: number
  },
): Promise<CatalogSearchHit[]> {
  if (input.embedding.length !== embeddingDimensions) {
    throw new Error(
      `Embedding must have ${embeddingDimensions} dimensions, received ${input.embedding.length}`,
    )
  }
  const result = await pool.query<{
    sku: string
    name: string
    description: string
    unit_price_cents: number
    keyword_rank: number | string
    similarity: number | string
  }>(
    `SELECT sku, name, description, unit_price_cents, keyword_rank, similarity
     FROM (
       SELECT
         sku,
         name,
         description,
         unit_price_cents,
         ts_rank(
           to_tsvector('simple', name || ' ' || description),
           plainto_tsquery('simple', $2)
         ) AS keyword_rank,
         1 - (embedding <=> $3::vector) AS similarity,
         to_tsvector('simple', name || ' ' || description)
           @@ plainto_tsquery('simple', $2) AS keyword_hit
       FROM catalog_products
       WHERE tenant_id = $1
     ) ranked
     ORDER BY keyword_hit DESC, similarity DESC, keyword_rank DESC
     LIMIT $4`,
    [
      parseTenantId(input.tenantId),
      input.query,
      vectorLiteral(input.embedding),
      input.limit,
    ],
  )
  return result.rows.map((row) => ({
    sku: row.sku,
    name: row.name,
    description: row.description,
    unitPriceCents: row.unit_price_cents,
    keywordRank: Number(row.keyword_rank),
    similarity: Number(row.similarity),
  }))
}

export async function listOrderTimelines(
  pool: Pool,
  tenantId: TenantId,
): Promise<StoredTimeline[]> {
  const orders = await pool.query<{
    id: string
    status: string
    version: number
    rejection_reason: string | null
  }>(
    `SELECT id, status, version, rejection_reason
     FROM orders
     WHERE tenant_id = $1
     ORDER BY created_at, id`,
    [tenantId],
  )
  const events = await pool.query<{
    id: string
    aggregate_id: string
    type: string
    created_at: Date
  }>(
    `SELECT id, aggregate_id, type, created_at
     FROM outbox
     WHERE tenant_id = $1 AND aggregate_type = 'order'
     ORDER BY created_at, id`,
    [tenantId],
  )
  const byOrder = new Map<string, StoredTimeline['events']>()
  for (const event of events.rows) {
    const list = byOrder.get(event.aggregate_id) ?? []
    list.push({
      messageId: event.id,
      type: event.type,
      occurredAt: new Date(event.created_at).toISOString(),
    })
    byOrder.set(event.aggregate_id, list)
  }
  return orders.rows.map((order) => ({
    orderId: order.id,
    status: order.status,
    version: order.version,
    rejectionReason: order.rejection_reason,
    events: byOrder.get(order.id) ?? [],
  }))
}

function toProduct(row: {
  id: string
  tenant_id: string
  sku: string
  name: string
  description: string
  unit_price_cents: number
}): CatalogProductRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    unitPriceCents: row.unit_price_cents,
  }
}

function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(',')}]`
}
