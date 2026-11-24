import { randomUUID } from 'node:crypto'
import { parseTenantId } from '@meridian/kernel'
import type { Pool, PoolClient } from 'pg'
import { applyTenant } from './tenant-session.js'

export type AgentRunRecord = {
  id: string
  tenantId: string
  promptVersion: string
  status: 'completed' | 'blocked'
  request: string
  transcript: unknown[]
  blockedReason: string | null
  approvalId: string | null
  createdAt: string
}

type AgentRunRow = {
  id: string
  tenant_id: string
  prompt_version: string
  status: AgentRunRecord['status']
  request: string
  transcript: unknown[]
  blocked_reason: string | null
  approval_id: string | null
  created_at: Date
}

export async function recordAgentRun(
  pool: Pool,
  input: {
    tenantId: string
    promptVersion: string
    status: AgentRunRecord['status']
    request: string
    transcript: unknown[]
    blockedReason: string | null
    approvalId: string | null
  },
): Promise<AgentRunRecord> {
  const tenantId = parseTenantId(input.tenantId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await applyTenant(client, tenantId)
    const inserted = await client.query<AgentRunRow>(
      `INSERT INTO agent_runs
         (id, tenant_id, prompt_version, status, request, transcript, blocked_reason, approval_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
       RETURNING id, tenant_id, prompt_version, status, request, transcript,
                 blocked_reason, approval_id, created_at`,
      [
        randomUUID(),
        tenantId,
        input.promptVersion,
        input.status,
        input.request,
        JSON.stringify(input.transcript),
        input.blockedReason,
        input.approvalId,
      ],
    )
    const row = inserted.rows[0]
    if (!row) throw new Error('Agent run insert did not return a row')
    await client.query('COMMIT')
    return toRecord(row)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function loadAgentRun(
  client: PoolClient,
  runId: string,
): Promise<AgentRunRecord | null> {
  const result = await client.query<AgentRunRow>(
    `SELECT id, tenant_id, prompt_version, status, request, transcript,
            blocked_reason, approval_id, created_at
     FROM agent_runs
     WHERE id = $1`,
    [runId],
  )
  const row = result.rows[0]
  return row ? toRecord(row) : null
}

export async function listAgentRuns(
  client: PoolClient,
): Promise<AgentRunRecord[]> {
  const result = await client.query<AgentRunRow>(
    `SELECT id, tenant_id, prompt_version, status, request, transcript,
            blocked_reason, approval_id, created_at
     FROM agent_runs
     ORDER BY created_at ASC`,
  )
  return result.rows.map(toRecord)
}

function toRecord(row: AgentRunRow): AgentRunRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    promptVersion: row.prompt_version,
    status: row.status,
    request: row.request,
    transcript: row.transcript,
    blockedReason: row.blocked_reason,
    approvalId: row.approval_id,
    createdAt: row.created_at.toISOString(),
  }
}
