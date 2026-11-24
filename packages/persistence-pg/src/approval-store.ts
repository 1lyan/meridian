import { randomUUID } from 'node:crypto'
import {
  decide,
  markExecuted,
  type PricedLine,
  type ProposalLine,
  proposedState,
} from '@meridian/domain-approvals'
import { DomainError, parseTenantId } from '@meridian/kernel'
import type { Pool, PoolClient } from 'pg'
import { loadCatalogProduct } from './catalog-store.js'
import { applyTenant, writeAudit } from './tenant-session.js'

export type ApprovalRecord = {
  id: string
  tenantId: string
  status: 'proposed' | 'approved' | 'rejected' | 'executed'
  currency: 'USD'
  lines: PricedLine[]
  proposedBy: string
  decidedBy: string | null
  orderId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

type ApprovalRow = {
  id: string
  tenant_id: string
  status: ApprovalRecord['status']
  currency: 'USD'
  lines: PricedLine[]
  proposed_by: string
  decided_by: string | null
  order_id: string | null
  version: number
  created_at: Date
  updated_at: Date
}

export async function proposeApproval(
  pool: Pool,
  input: {
    tenantId: string
    lines: readonly ProposalLine[]
    actorId: string
  },
): Promise<ApprovalRecord> {
  const tenantId = parseTenantId(input.tenantId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await applyTenant(client, tenantId)
    const lines: PricedLine[] = []
    for (const line of input.lines) {
      const product = await loadCatalogProduct(client, tenantId, line.sku)
      if (!product) {
        throw new DomainError('unknown_sku', `Unknown sku ${line.sku}`)
      }
      lines.push({
        sku: line.sku,
        quantity: line.quantity,
        unitPriceCents: product.unitPriceCents,
      })
    }
    const state = proposedState()
    const id = randomUUID()
    const inserted = await client.query<ApprovalRow>(
      `INSERT INTO approvals
         (id, tenant_id, status, currency, lines, proposed_by, version, created_at, updated_at)
       VALUES ($1, $2, $3, 'USD', $4::jsonb, $5, $6, now(), now())
       RETURNING id, tenant_id, status, currency, lines, proposed_by, decided_by,
                 order_id, version, created_at, updated_at`,
      [
        id,
        tenantId,
        state.status,
        JSON.stringify(lines),
        input.actorId,
        state.version,
      ],
    )
    const row = inserted.rows[0]
    if (!row) throw new Error('Approval insert did not return a row')
    await writeAudit(client, {
      tenantId,
      actorId: input.actorId,
      action: 'approval.propose',
      aggregateType: 'approval',
      aggregateId: id,
      detail: lines.map((line) => line.sku).join(','),
    })
    await client.query('COMMIT')
    return toRecord(row)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function listApprovals(
  client: PoolClient,
  limit: number,
): Promise<ApprovalRecord[]> {
  const result = await client.query<ApprovalRow>(
    `SELECT id, tenant_id, status, currency, lines, proposed_by, decided_by,
            order_id, version, created_at, updated_at
     FROM approvals
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows.map(toRecord)
}

export async function loadApproval(
  client: PoolClient,
  approvalId: string,
): Promise<ApprovalRecord | null> {
  const result = await client.query<ApprovalRow>(
    `SELECT id, tenant_id, status, currency, lines, proposed_by, decided_by,
            order_id, version, created_at, updated_at
     FROM approvals
     WHERE id = $1`,
    [approvalId],
  )
  const row = result.rows[0]
  return row ? toRecord(row) : null
}

export async function decideApproval(
  pool: Pool,
  input: {
    tenantId: string
    approvalId: string
    decision: 'approve' | 'reject'
    actorId: string
  },
): Promise<ApprovalRecord> {
  const tenantId = parseTenantId(input.tenantId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await applyTenant(client, tenantId)
    const current = await lockApproval(client, input.approvalId)
    const next = decide(current, input.decision)
    const updated = await client.query<ApprovalRow>(
      `UPDATE approvals
       SET status = $2, version = $3, decided_by = $4, updated_at = now()
       WHERE id = $1 AND status = 'proposed'
       RETURNING id, tenant_id, status, currency, lines, proposed_by, decided_by,
                 order_id, version, created_at, updated_at`,
      [input.approvalId, next.status, next.version, input.actorId],
    )
    const row = updated.rows[0]
    if (!row) {
      throw new DomainError(
        'invalid_transition',
        'The approval changed before it could be decided',
      )
    }
    await writeAudit(client, {
      tenantId,
      actorId: input.actorId,
      action:
        input.decision === 'approve' ? 'approval.approve' : 'approval.reject',
      aggregateType: 'approval',
      aggregateId: input.approvalId,
      detail: next.status,
    })
    await client.query('COMMIT')
    return toRecord(row)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function markApprovalExecuted(
  pool: Pool,
  input: {
    tenantId: string
    approvalId: string
    orderId: string
    actorId: string
  },
): Promise<ApprovalRecord> {
  const tenantId = parseTenantId(input.tenantId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await applyTenant(client, tenantId)
    const current = await lockApproval(client, input.approvalId)
    if (current.status === 'executed') {
      await client.query('COMMIT')
      return current
    }
    const next = markExecuted(current)
    const updated = await client.query<ApprovalRow>(
      `UPDATE approvals
       SET status = $2, version = $3, order_id = $4, updated_at = now()
       WHERE id = $1 AND status = 'approved'
       RETURNING id, tenant_id, status, currency, lines, proposed_by, decided_by,
                 order_id, version, created_at, updated_at`,
      [input.approvalId, next.status, next.version, input.orderId],
    )
    const row = updated.rows[0]
    if (!row) {
      throw new DomainError(
        'invalid_transition',
        'The approval changed before it could be executed',
      )
    }
    await writeAudit(client, {
      tenantId,
      actorId: input.actorId,
      action: 'approval.execute',
      aggregateType: 'approval',
      aggregateId: input.approvalId,
      detail: input.orderId,
    })
    await client.query('COMMIT')
    return toRecord(row)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function lockApproval(
  client: PoolClient,
  approvalId: string,
): Promise<ApprovalRecord> {
  const result = await client.query<ApprovalRow>(
    `SELECT id, tenant_id, status, currency, lines, proposed_by, decided_by,
            order_id, version, created_at, updated_at
     FROM approvals
     WHERE id = $1
     FOR UPDATE`,
    [approvalId],
  )
  const row = result.rows[0]
  if (!row) {
    throw new DomainError('not_found', 'Approval not found')
  }
  return toRecord(row)
}

function toRecord(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status,
    currency: row.currency,
    lines: row.lines,
    proposedBy: row.proposed_by,
    decidedBy: row.decided_by,
    orderId: row.order_id,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}
