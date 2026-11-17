import type { TenantId } from '@meridian/kernel'

/** Quantities the order saga will reserve in phase 1. Postgres holds them. */
export type StockItem = {
  tenantId: TenantId
  sku: string
  warehouseId: string
  onHand: number
  reserved: number
}

export const inventoryContext = 'inventory' as const
