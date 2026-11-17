import { newOrderId, parseTenantId } from '@meridian/kernel'
import { describe, expect, it } from 'vitest'
import { placeOrder } from './place-order.js'

const tenantId = parseTenantId('6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b')
const now = new Date('2026-11-17T12:00:00.000Z')

function command(
  lines: { sku: string; quantity: number; unitPriceCents: number }[],
) {
  return {
    tenantId,
    orderId: newOrderId(),
    currency: 'USD' as const,
    lines,
    now,
  }
}

describe('placeOrder', () => {
  it('places version 1 and emits OrderPlaced with the same lines', () => {
    const orderId = newOrderId()
    const placed = placeOrder({
      ...command([{ sku: ' GLV-100 ', quantity: 2, unitPriceCents: 499 }]),
      orderId,
    })

    expect(placed.order).toMatchObject({
      id: orderId,
      tenantId,
      status: 'placed',
      version: 1,
      currency: 'USD',
      lines: [{ sku: 'GLV-100', quantity: 2, unitPriceCents: 499 }],
      createdAt: now,
    })
    expect(placed.event).toMatchObject({
      type: 'OrderPlaced',
      orderId,
      tenantId,
      version: 1,
      occurredAt: now,
      lines: placed.order.lines,
    })
  })

  it('rejects an empty order', () => {
    expect(() => placeOrder(command([]))).toThrow(/at least one line/)
  })

  it('rejects a non-positive or fractional quantity', () => {
    expect(() =>
      placeOrder(command([{ sku: 'A', quantity: 0, unitPriceCents: 1 }])),
    ).toThrow(/Quantity/)
    expect(() =>
      placeOrder(command([{ sku: 'A', quantity: 1.5, unitPriceCents: 1 }])),
    ).toThrow(/Quantity/)
  })

  it('rejects a negative or fractional price', () => {
    expect(() =>
      placeOrder(command([{ sku: 'A', quantity: 1, unitPriceCents: -1 }])),
    ).toThrow(/price/)
    expect(() =>
      placeOrder(command([{ sku: 'A', quantity: 1, unitPriceCents: 1.2 }])),
    ).toThrow(/price/)
  })

  it('rejects a blank sku and a duplicate sku', () => {
    expect(() =>
      placeOrder(command([{ sku: '   ', quantity: 1, unitPriceCents: 1 }])),
    ).toThrow(/Sku/)
    expect(() =>
      placeOrder(
        command([
          { sku: 'A', quantity: 1, unitPriceCents: 1 },
          { sku: 'A', quantity: 2, unitPriceCents: 1 },
        ]),
      ),
    ).toThrow(/more than once/)
  })
})
