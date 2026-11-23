import { DomainError, type TenantId } from '@meridian/kernel'

export const inventoryContext = 'inventory' as const

export const defaultWarehouseId = '00000000-0000-4000-8000-000000000001'

export type StockItem = {
  tenantId: TenantId
  sku: string
  warehouseId: string
  onHand: number
  reserved: number
  version: number
}

export type ReserveResult =
  | { ok: true; stock: StockItem }
  | { ok: false; reason: 'insufficient_stock' }

export function receive(stock: StockItem, quantity: number): StockItem {
  assertQuantity(quantity)
  return {
    ...stock,
    onHand: stock.onHand + quantity,
    version: stock.version + 1,
  }
}

export function tryReserve(stock: StockItem, quantity: number): ReserveResult {
  assertQuantity(quantity)
  if (stock.reserved + quantity > stock.onHand) {
    return { ok: false, reason: 'insufficient_stock' }
  }
  return {
    ok: true,
    stock: {
      ...stock,
      reserved: stock.reserved + quantity,
      version: stock.version + 1,
    },
  }
}

export function release(stock: StockItem, quantity: number): StockItem {
  assertQuantity(quantity)
  if (quantity > stock.reserved) {
    throw new DomainError(
      'release_exceeds_reserved',
      'Cannot release more than the reserved quantity',
    )
  }
  return {
    ...stock,
    reserved: stock.reserved - quantity,
    version: stock.version + 1,
  }
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new DomainError(
      'invalid_quantity',
      'Quantity must be a positive integer',
    )
  }
}
