import type { TenantId } from '@meridian/kernel'

/** Identity and price live in Postgres. Rich catalog content is a Mongo document in phase 2. */
export type SkuRecord = {
  tenantId: TenantId
  sku: string
  unitPriceCents: number
}

export const catalogContext = 'catalog' as const
