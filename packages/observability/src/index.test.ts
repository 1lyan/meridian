import { describe, expect, it } from 'vitest'
import { createLogger } from './index.js'

describe('createLogger', () => {
  it('stamps the service name onto every line', () => {
    expect(createLogger('api').bindings()).toMatchObject({ service: 'api' })
  })
})
