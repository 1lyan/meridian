import { parseTenantId } from '@meridian/kernel'
import type { PoolClient } from 'pg'
import { loadCatalogProduct } from './catalog-store.js'

export async function availableToPromise(
  client: PoolClient,
  tenantId: string,
  sku: string,
): Promise<{
  sku: string
  onHand: number
  reserved: number
  available: number
}> {
  const result = await client.query<{ on_hand: string; reserved: string }>(
    `SELECT COALESCE(SUM(on_hand), 0)::text AS on_hand,
            COALESCE(SUM(reserved), 0)::text AS reserved
     FROM stock_items
     WHERE tenant_id = $1 AND sku = $2`,
    [parseTenantId(tenantId), sku],
  )
  const row = result.rows[0]
  const onHand = Number(row?.on_hand ?? 0)
  const reserved = Number(row?.reserved ?? 0)
  return { sku, onHand, reserved, available: onHand - reserved }
}

export async function quoteCatalogSku(
  client: PoolClient,
  tenantId: string,
  sku: string,
  quantity: number,
): Promise<{
  sku: string
  quantity: number
  unitPriceCents: number
  totalCents: number
} | null> {
  const product = await loadCatalogProduct(client, tenantId, sku)
  if (!product) return null
  return {
    sku,
    quantity,
    unitPriceCents: product.unitPriceCents,
    totalCents: product.unitPriceCents * quantity,
  }
}
