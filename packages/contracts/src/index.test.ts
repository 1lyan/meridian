import { describe, expect, it } from 'vitest'
import { placeOrderBody } from './index.js'

describe('placeOrderBody', () => {
  it('accepts a normalized line and trims the sku', () => {
    const parsed = placeOrderBody.parse({
      currency: 'USD',
      lines: [{ sku: ' GLV-100 ', quantity: 2, unitPriceCents: 499 }],
    })
    expect(parsed.lines[0]?.sku).toBe('GLV-100')
  })

  it('rejects an unknown field and a duplicate sku', () => {
    expect(
      placeOrderBody.safeParse({
        currency: 'USD',
        note: 'rush',
        lines: [{ sku: 'A', quantity: 1, unitPriceCents: 1 }],
      }).success,
    ).toBe(false)
    expect(
      placeOrderBody.safeParse({
        currency: 'USD',
        lines: [
          { sku: 'A', quantity: 1, unitPriceCents: 1 },
          { sku: 'A', quantity: 2, unitPriceCents: 1 },
        ],
      }).success,
    ).toBe(false)
  })
})
