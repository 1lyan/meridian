import { describe, expect, it } from 'vitest'
import { decideDisposition, retryTtlMs, routingKeyFor } from './index.js'

describe('delivery disposition', () => {
  it('retries the first three attempts and then dead-letters', () => {
    expect(decideDisposition(0)).toBe('retry')
    expect(decideDisposition(2)).toBe('retry')
    expect(decideDisposition(3)).toBe('dead-letter')
  })

  it('uses the retry ladder', () => {
    expect(retryTtlMs(0)).toBe(1000)
    expect(retryTtlMs(1)).toBe(5000)
    expect(retryTtlMs(2)).toBe(15_000)
  })

  it('routes each saga type to its own key', () => {
    expect(routingKeyFor('OrderPlaced')).toBe('order.placed')
    expect(routingKeyFor('ReleaseReservation')).toBe('inventory.release')
    expect(routingKeyFor('CatalogUpserted')).toBe('catalog.upserted')
    expect(() => routingKeyFor('Nope')).toThrow(/Nope/)
  })
})
