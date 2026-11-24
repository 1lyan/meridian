import { randomUUID } from 'node:crypto'
import { createTestIdentity } from '@meridian/auth'
import { migrate, withTenant } from '@meridian/persistence-pg'
import { startPostgres } from '@meridian/testkit'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

const body = {
  currency: 'USD',
  lines: [{ sku: 'GLV-100', quantity: 1, unitPriceCents: 499 }],
}

describe('tenant isolation', () => {
  let container: Awaited<ReturnType<typeof startPostgres>>
  let pool: Pool
  let app: Awaited<ReturnType<typeof buildApp>>
  let bearer: (tenantId: string, subject: string) => Promise<string>

  beforeAll(async () => {
    container = await startPostgres()
    pool = new Pool({ connectionString: container.getConnectionUri() })
    await migrate(pool)
    const identity = await createTestIdentity()
    bearer = async (tenantId, subject) =>
      `Bearer ${await identity.sign({ tenantId, subject })}`
    app = await buildApp({ pool, identity: identity.identity })
  }, 300_000)

  afterAll(async () => {
    await app?.close()
    await pool?.end()
    await container?.stop()
  })

  it('keeps tenant B out of tenant A through HTTP, the audit log, and row-level security', async () => {
    const tenantA = randomUUID()
    const tenantB = randomUUID()
    const placed = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: {
        authorization: await bearer(tenantA, 'alice'),
        'idempotency-key': 'tenant-a',
      },
      payload: body,
    })
    expect(placed.statusCode).toBe(201)
    const orderId = placed.json<{ orderId: string }>().orderId

    const hidden = await app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: { authorization: await bearer(tenantB, 'bob') },
    })
    expect(hidden.statusCode).toBe(404)

    const auditA = await app.inject({
      method: 'GET',
      url: '/v1/audit',
      headers: { authorization: await bearer(tenantA, 'alice') },
    })
    expect(auditA.statusCode).toBe(200)
    expect(
      auditA.json<{ entries: { action: string; actorId: string }[] }>().entries,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'order.place', actorId: 'alice' }),
      ]),
    )
    const auditB = await app.inject({
      method: 'GET',
      url: '/v1/audit',
      headers: { authorization: await bearer(tenantB, 'bob') },
    })
    expect(auditB.json<{ entries: unknown[] }>().entries).toEqual([])

    const asOwner = await withTenant(pool, tenantA, async (client) => {
      const role = await client.query<{ current_user: string }>(
        'select current_user',
      )
      const rows = await client.query<{ id: string }>('select id from orders')
      return {
        role: role.rows[0]?.current_user,
        ids: rows.rows.map((row) => row.id),
      }
    })
    expect(asOwner.role).toBe('meridian_app')
    expect(asOwner.ids).toEqual([orderId])

    const asOther = await withTenant(pool, tenantB, async (client) => {
      const rows = await client.query('select id from orders')
      return rows.rows
    })
    expect(asOther).toEqual([])
  })
})
