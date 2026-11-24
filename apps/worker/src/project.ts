import { parseTenantId } from '@meridian/kernel'
import type { Projections } from '@meridian/persistence-mongo'
import { loadCatalogProduct, loadOrder } from '@meridian/persistence-pg'
import type { Pool } from 'pg'
import { z } from 'zod'
import type { IncomingMessage } from './dispatch.js'

const catalogFact = z.object({
  sku: z.string().min(1),
  tenantId: z.string().uuid(),
})

const orderFact = z.object({
  orderId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

export async function projectMessage(
  pool: Pool,
  projections: Projections,
  message: IncomingMessage,
): Promise<void> {
  if (message.type === 'CatalogUpserted') {
    const fact = catalogFact.parse(message.payload)
    const product = await loadCatalogProduct(pool, fact.tenantId, fact.sku)
    if (!product) throw new Error(`Catalog product ${fact.sku} does not exist`)
    await projections.upsertCatalog({
      tenantId: product.tenantId,
      sku: product.sku,
      name: product.name,
      description: product.description,
      unitPriceCents: product.unitPriceCents,
    })
    return
  }

  const parsed = orderFact.safeParse(message.payload)
  if (!parsed.success) return
  const tenantId = parseTenantId(parsed.data.tenantId)
  const order = await loadOrder(pool, tenantId, parsed.data.orderId)
  if (!order) return
  await projections.appendOrderEvent({
    tenantId: order.tenantId,
    orderId: order.id,
    status: order.status,
    version: order.version,
    rejectionReason: order.rejectionReason,
    event: {
      messageId: message.messageId,
      type: message.type,
      occurredAt: new Date().toISOString(),
    },
  })
}
