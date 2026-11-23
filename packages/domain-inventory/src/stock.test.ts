import { parseTenantId } from '@meridian/kernel'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  defaultWarehouseId,
  receive,
  release,
  type StockItem,
  tryReserve,
} from './index.js'

const tenantId = parseTenantId('6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b')

function empty(): StockItem {
  return {
    tenantId,
    sku: 'GLV-100',
    warehouseId: defaultWarehouseId,
    onHand: 0,
    reserved: 0,
    version: 0,
  }
}

describe('stock', () => {
  it('keeps reserved inside on-hand for any receive, reserve, and release sequence', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom('receive', 'reserve', 'release'),
            quantity: fc.integer({ min: 1, max: 20 }),
          }),
          { maxLength: 40 },
        ),
        (steps) => {
          let stock = empty()
          for (const step of steps) {
            if (step.kind === 'receive') stock = receive(stock, step.quantity)
            if (step.kind === 'reserve') {
              const reserved = tryReserve(stock, step.quantity)
              if (reserved.ok) stock = reserved.stock
            }
            if (step.kind === 'release' && stock.reserved >= step.quantity) {
              stock = release(stock, step.quantity)
            }
            expect(stock.reserved).toBeLessThanOrEqual(stock.onHand)
            expect(stock.reserved).toBeGreaterThanOrEqual(0)
            expect(stock.onHand).toBeGreaterThanOrEqual(0)
          }
        },
      ),
    )
  })
})
