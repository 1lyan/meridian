import { describe, expect, it } from 'vitest'
import { decide, markExecuted, proposedState } from './approval.js'
import { screenToolCall } from './policy.js'

const tenant = '6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b'

describe('approval transitions', () => {
  it('moves proposed to approved and then executed', () => {
    const approved = decide(proposedState(), 'approve')
    expect(approved).toEqual({ status: 'approved', version: 2 })
    expect(markExecuted(approved)).toEqual({ status: 'executed', version: 3 })
  })

  it('refuses to execute a proposal that was not approved', () => {
    expect(() => markExecuted(proposedState())).toThrow(/Cannot execute/)
  })
})

describe('tool policy', () => {
  it('refuses a commit tool before it looks at the tenant', () => {
    expect(() =>
      screenToolCall({
        name: 'placeOrder',
        arguments: {},
        sessionTenantId: tenant,
        observedSkus: new Set(),
      }),
    ).toThrow(/commits stock or money/)
  })

  it('refuses a sku that search did not return', () => {
    expect(() =>
      screenToolCall({
        name: 'proposeApproval',
        arguments: {
          tenantId: tenant,
          lines: [{ sku: 'SKU-POISON', quantity: 1 }],
        },
        sessionTenantId: tenant,
        observedSkus: new Set(['GLV-100']),
      }),
    ).toThrow(/SKU-POISON/)
  })
})
