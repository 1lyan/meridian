import { DomainError, parseTenantId } from '@meridian/kernel'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { assertBalanced, journalForCapture } from './index.js'

const tenantId = parseTenantId('6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b')

describe('journal', () => {
  it('balances every non-negative capture amount', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (amountCents) => {
        expect(() => journalForCapture(tenantId, amountCents)).not.toThrow()
        assertBalanced(journalForCapture(tenantId, amountCents))
      }),
    )
  })

  it('rejects a journal whose lines do not sum to zero', () => {
    expect(() =>
      assertBalanced({
        tenantId,
        lines: [{ account: 'accounts_receivable', amountCents: 100 }],
      }),
    ).toThrow(DomainError)
  })
})
