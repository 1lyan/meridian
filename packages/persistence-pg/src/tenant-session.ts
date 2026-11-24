import { randomUUID } from 'node:crypto'
import { parseTenantId } from '@meridian/kernel'
import type { Pool, PoolClient } from 'pg'

/** Request and consumer transactions adopt this role so row-level security applies. */
export const appRole = 'meridian_app'

export async function applyTenant(
  client: PoolClient,
  tenantId: string,
): Promise<void> {
  const parsed = parseTenantId(tenantId)
  await client.query(`SET LOCAL ROLE ${appRole}`)
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [parsed])
}

export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await applyTenant(client, tenantId)
    const value = await work(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function writeAudit(
  client: PoolClient,
  input: {
    tenantId: string
    actorId: string
    action: string
    aggregateType: string
    aggregateId: string
    detail: string | null
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (id, tenant_id, actor_id, action, aggregate_type, aggregate_id, detail, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [
      randomUUID(),
      parseTenantId(input.tenantId),
      input.actorId,
      input.action,
      input.aggregateType,
      input.aggregateId,
      input.detail,
    ],
  )
}

export type AuditEntry = {
  id: string
  actorId: string
  action: string
  aggregateType: string
  aggregateId: string
  detail: string | null
  createdAt: string
}

export async function listAudit(
  client: PoolClient,
  limit: number,
): Promise<AuditEntry[]> {
  const result = await client.query<{
    id: string
    actor_id: string
    action: string
    aggregate_type: string
    aggregate_id: string
    detail: string | null
    created_at: Date
  }>(
    `SELECT id, actor_id, action, aggregate_type, aggregate_id, detail, created_at
     FROM audit_log
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows.map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    detail: row.detail,
    createdAt: new Date(row.created_at).toISOString(),
  }))
}
