import { describe, expect, it } from 'vitest'
import {
  InvalidTenantIdError,
  newOrderId,
  parseOrderId,
  parseTenantId,
} from './index.js'

describe('parseTenantId', () => {
  it('accepts a UUID and brands it', () => {
    const value = '6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b'
    expect(parseTenantId(value)).toBe(value)
  })

  it('rejects anything that is not a UUID', () => {
    expect(() => parseTenantId('clinic-north')).toThrow(InvalidTenantIdError)
  })
})

describe('order ids', () => {
  it('mints a UUID that parses back', () => {
    const id = newOrderId()
    expect(parseOrderId(id)).toBe(id)
  })
})
