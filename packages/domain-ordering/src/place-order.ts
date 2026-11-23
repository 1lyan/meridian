import type { OrderId, TenantId } from '@meridian/kernel'
import { DomainError } from '@meridian/kernel'

export type Currency = 'USD'

export type OrderLine = {
  sku: string
  quantity: number
  unitPriceCents: number
}

export type PlacedOrder = {
  id: OrderId
  tenantId: TenantId
  status: 'placed'
  version: 1
  currency: Currency
  lines: readonly OrderLine[]
  paymentOutcome: PaymentOutcome
  createdAt: Date
}

export type OrderPlaced = {
  type: 'OrderPlaced'
  orderId: OrderId
  tenantId: TenantId
  currency: Currency
  lines: readonly OrderLine[]
  occurredAt: Date
  version: 1
}

export type PaymentOutcome = 'capture' | 'decline'

export type PlaceOrderCommand = {
  tenantId: TenantId
  orderId: OrderId
  currency: Currency
  lines: readonly OrderLine[]
  now: Date
  paymentOutcome?: PaymentOutcome
}

const maxSkuLength = 64

export function placeOrder(command: PlaceOrderCommand): {
  order: PlacedOrder
  event: OrderPlaced
} {
  if (command.lines.length === 0) {
    throw new DomainError('empty_order', 'An order needs at least one line')
  }

  const lines = command.lines.map(normalizeLine)
  const seen = new Set<string>()
  for (const line of lines) {
    if (seen.has(line.sku)) {
      throw new DomainError(
        'duplicate_sku',
        `Sku ${line.sku} appears more than once`,
      )
    }
    seen.add(line.sku)
  }

  const order: PlacedOrder = {
    id: command.orderId,
    tenantId: command.tenantId,
    status: 'placed',
    version: 1,
    currency: command.currency,
    lines,
    paymentOutcome: command.paymentOutcome ?? 'capture',
    createdAt: command.now,
  }

  const event: OrderPlaced = {
    type: 'OrderPlaced',
    orderId: order.id,
    tenantId: order.tenantId,
    currency: order.currency,
    lines: order.lines,
    occurredAt: order.createdAt,
    version: order.version,
  }

  return { order, event }
}

function normalizeLine(line: OrderLine): OrderLine {
  const sku = line.sku.trim()
  if (sku.length === 0 || sku.length > maxSkuLength) {
    throw new DomainError('invalid_sku', 'Sku must be 1 to 64 characters')
  }
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new DomainError(
      'invalid_quantity',
      'Quantity must be a positive integer',
    )
  }
  if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
    throw new DomainError(
      'invalid_price',
      'Unit price must be a non-negative integer number of cents',
    )
  }
  return { sku, quantity: line.quantity, unitPriceCents: line.unitPriceCents }
}
