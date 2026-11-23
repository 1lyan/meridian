import { DomainError, type TenantId } from '@meridian/kernel'

export const billingContext = 'billing' as const

export const accounts = {
  receivable: 'accounts_receivable',
  revenue: 'sales_revenue',
} as const

export type JournalLine = {
  account: string
  amountCents: number
}

export type JournalEntry = {
  tenantId: TenantId
  lines: readonly JournalLine[]
}

export function journalForCapture(
  tenantId: TenantId,
  amountCents: number,
): JournalEntry {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new DomainError(
      'invalid_amount',
      'Capture amount must be a non-negative integer number of cents',
    )
  }
  const entry: JournalEntry = {
    tenantId,
    lines: [
      { account: accounts.receivable, amountCents },
      { account: accounts.revenue, amountCents: -amountCents },
    ],
  }
  assertBalanced(entry)
  return entry
}

export function assertBalanced(entry: JournalEntry): void {
  const total = entry.lines.reduce((sum, line) => sum + line.amountCents, 0)
  if (total !== 0) {
    throw new DomainError(
      'unbalanced_journal',
      `Journal lines must sum to zero, received ${total}`,
    )
  }
}
