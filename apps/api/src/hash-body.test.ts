import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashRequestBody } from './hash-body.js'

describe('hashRequestBody', () => {
  it('is stable for the same normalized body', () => {
    const body = {
      currency: 'USD' as const,
      lines: [{ sku: 'GLV-100', quantity: 2, unitPriceCents: 499 }],
    }
    expect(hashRequestBody(body)).toBe(hashRequestBody(body))
    expect(hashRequestBody(body)).toBe(
      createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    )
  })
})
