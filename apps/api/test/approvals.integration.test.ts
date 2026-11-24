import { randomUUID } from 'node:crypto'
import { createTestIdentity } from '@meridian/auth'
import { createProjections } from '@meridian/persistence-mongo'
import { migrate, withTenant } from '@meridian/persistence-pg'
import { startMongo, startPostgres } from '@meridian/testkit'
import { MongoClient } from 'mongodb'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

const product = {
  sku: 'GLV-100',
  name: 'Nitrile exam gloves',
  description: 'Powder-free nitrile gloves',
  unitPriceCents: 499,
}

describe('approvals and agent runs', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>
  let mongo: Awaited<ReturnType<typeof startMongo>>
  let pool: Pool
  let mongoClient: MongoClient
  let projections: ReturnType<typeof createProjections>
  let app: Awaited<ReturnType<typeof buildApp>>
  let bearer: (tenantId: string, subject: string) => Promise<string>

  beforeAll(async () => {
    postgres = await startPostgres()
    mongo = await startMongo()
    pool = new Pool({ connectionString: postgres.getConnectionUri() })
    await migrate(pool)
    mongoClient = new MongoClient(mongo.getConnectionString(), {
      directConnection: true,
    })
    await mongoClient.connect()
    projections = createProjections(mongoClient.db('meridian'))
    await projections.ensureIndexes()
    const identity = await createTestIdentity()
    bearer = async (tenantId, subject) =>
      `Bearer ${await identity.sign({ tenantId, subject })}`
    app = await buildApp({
      pool,
      identity: identity.identity,
      projections,
    })
  }, 300_000)

  afterAll(async () => {
    await app?.close()
    await mongoClient?.close()
    await pool?.end()
    await mongo?.stop()
    await postgres?.stop()
  })

  it('lets a person execute an approval and keeps the other tenant out of the run', async () => {
    const tenantA = randomUUID()
    const tenantB = randomUUID()
    const authA = { authorization: await bearer(tenantA, 'alice') }
    const authB = { authorization: await bearer(tenantB, 'bob') }

    const catalog = await app.inject({
      method: 'POST',
      url: '/v1/catalog',
      headers: authA,
      payload: product,
    })
    expect(catalog.statusCode).toBe(200)

    const proposed = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: authA,
      payload: { currency: 'USD', lines: [{ sku: 'GLV-100', quantity: 2 }] },
    })
    expect(proposed.statusCode).toBe(201)
    const approval = proposed.json<{
      id: string
      lines: { unitPriceCents: number }[]
    }>()
    expect(approval.lines[0]?.unitPriceCents).toBe(499)

    const hidden = await app.inject({
      method: 'GET',
      url: `/v1/approvals/${approval.id}`,
      headers: authB,
    })
    expect(hidden.statusCode).toBe(404)

    const tooSoon = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approval.id}/execute`,
      headers: authA,
    })
    expect(tooSoon.statusCode).toBe(409)

    const decision = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approval.id}/decision`,
      headers: authA,
      payload: { decision: 'approve' },
    })
    expect(decision.statusCode).toBe(200)

    const executed = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approval.id}/execute`,
      headers: authA,
    })
    expect(executed.statusCode).toBe(200)
    const orderId = executed.json<{ orderId: string }>().orderId
    const order = await app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: authA,
    })
    expect(order.statusCode).toBe(200)
    expect(order.json<{ status: string }>().status).toBe('placed')

    const run = await app.inject({
      method: 'POST',
      url: '/v1/agent-runs',
      headers: authA,
      payload: {
        promptVersion: 'buyer-1',
        status: 'completed',
        request: 'nitrile gloves',
        transcript: [{ kind: 'final', text: 'Proposed.' }],
        blockedReason: null,
        approvalId: approval.id,
      },
    })
    expect(run.statusCode).toBe(201)
    const runId = run.json<{ id: string }>().id

    const hiddenRun = await app.inject({
      method: 'GET',
      url: `/v1/agent-runs/${runId}`,
      headers: authB,
    })
    expect(hiddenRun.statusCode).toBe(404)
    expect(await projections.getAgentRun(tenantB, runId)).toBeNull()
    expect((await projections.getAgentRun(tenantA, runId))?.promptVersion).toBe(
      'buyer-1',
    )

    await mongoClient.db('meridian').collection('agent-run').deleteMany({})
    expect(await projections.getAgentRun(tenantA, runId)).toBeNull()
    const rebuilt = await app.inject({
      method: 'POST',
      url: '/v1/projections/rebuild',
      headers: authA,
    })
    expect(rebuilt.statusCode).toBe(200)
    expect(rebuilt.json<{ agentRuns: number }>().agentRuns).toBe(1)
    expect((await projections.getAgentRun(tenantA, runId))?.request).toBe(
      'nitrile gloves',
    )

    const visible = await withTenant(pool, tenantA, (client) =>
      client.query('select id from approvals'),
    )
    expect(visible.rows).toHaveLength(1)
    const empty = await withTenant(pool, tenantB, (client) =>
      client.query('select id from approvals'),
    )
    expect(empty.rows).toHaveLength(0)
  })
})
