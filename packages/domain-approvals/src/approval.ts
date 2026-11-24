import { DomainError } from '@meridian/kernel'

export type ApprovalStatus = 'proposed' | 'approved' | 'rejected' | 'executed'

export type ProposalLine = {
  sku: string
  quantity: number
}

export type PricedLine = ProposalLine & {
  unitPriceCents: number
}

export type ApprovalState = {
  status: ApprovalStatus
  version: number
}

const skuPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function proposalLines(value: unknown): ProposalLine[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new DomainError(
      'invalid_proposal',
      'A proposal needs between 1 and 100 lines',
    )
  }
  const seen = new Set<string>()
  const lines: ProposalLine[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      throw new DomainError('invalid_proposal', 'Each line must be an object')
    }
    const record = entry as Record<string, unknown>
    if (typeof record.sku !== 'string' || !skuPattern.test(record.sku)) {
      throw new DomainError('invalid_proposal', 'A line sku is invalid')
    }
    if (
      typeof record.quantity !== 'number' ||
      !Number.isInteger(record.quantity) ||
      record.quantity <= 0
    ) {
      throw new DomainError(
        'invalid_proposal',
        'A line quantity must be a positive integer',
      )
    }
    if (seen.has(record.sku)) {
      throw new DomainError('invalid_proposal', `Duplicate sku ${record.sku}`)
    }
    seen.add(record.sku)
    lines.push({ sku: record.sku, quantity: record.quantity })
  }
  return lines
}

export function proposedState(): ApprovalState {
  return { status: 'proposed', version: 1 }
}

export function decide(
  current: ApprovalState,
  decision: 'approve' | 'reject',
): ApprovalState {
  if (current.status !== 'proposed') {
    throw new DomainError(
      'invalid_transition',
      `Cannot ${decision} an approval in status ${current.status}`,
    )
  }
  return {
    status: decision === 'approve' ? 'approved' : 'rejected',
    version: current.version + 1,
  }
}

export function markExecuted(current: ApprovalState): ApprovalState {
  if (current.status !== 'approved') {
    throw new DomainError(
      'invalid_transition',
      `Cannot execute an approval in status ${current.status}`,
    )
  }
  return { status: 'executed', version: current.version + 1 }
}
