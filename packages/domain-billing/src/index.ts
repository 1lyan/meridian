import type { TenantId } from '@meridian/kernel'

/** A balanced journal is the billing invariant. The property test arrives with phase 1. */
export type JournalLine = {
  account: string
  amountCents: number
}

export type JournalEntry = {
  tenantId: TenantId
  lines: readonly JournalLine[]
}

export const billingContext = 'billing' as const
