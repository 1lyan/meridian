import { randomUUID } from 'node:crypto'
import { buildApp } from '@meridian/api/app'
import { createTestIdentity } from '@meridian/auth'
import { createProjections } from '@meridian/persistence-mongo'
import { migrate } from '@meridian/persistence-pg'
import { startMongo, startPostgres, startRabbit } from '@meridian/testkit'
import { startWorker, type Worker } from '@meridian/worker'
import { MongoClient } from 'mongodb'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectMessage } from '../src/project.js'

const gloves = {
  sku: 'GLV-100',
  name: 'Nitrile exam gloves',
  description: 'Powder-free nitrile gloves',
  unitPriceCents: 499,
}
const paper = {
  sku: 'PAP-100',
  name: 'Copy paper',
  description: 'Letter size white ream',
  unitPriceCents: 899,
}

describe('read side', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>
  let rabbit: Awaited<ReturnType<typeof startRabbit>>
  let mongo: Awaited<ReturnType<typeof startMongo>>
  let pool: Pool
  let mongoClient: MongoClient
  let app: Awaited<ReturnType<typeof buildApp>>
  let worker: Worker
  const tenantId = randomUUID()
  const otherTenantId = randomUUID()
  let orderId = ''
  let bearer!: (
    tenantId: string,
    extra?: Record<string, string>,
  ) => Promise<Record<string, string>>

  beforeAll(async () => {
    postgres = await startPostgres()
    rabbit = await startRabbit()
    mongo = await startMongo()
    pool = new Pool({ connectionString: postgres.getConnectionUri() })
    await migrate(pool)
    mongoClient = new MongoClient(mongo.getConnectionString(), {
      directConnection: true,
    })
    await mongoClient.connect()
    const projections = createProjections(mongoClient.db('meridian'))
    await projections.ensureIndexes()
    const identity = await createTestIdentity()
    bearer = async (tenantId, extra = {}) => ({
      authorization: `Bearer ${await identity.sign({ tenantId, subject: 'tester' })}`,
      ...extra,
    })
    app = await buildApp({ pool, projections, identity: identity.identity })
    worker = await startWorker({
      pool,
      rabbitUrl: rabbit.getAmqpUrl(),
      reservationTimeoutMs: 60_000,
      pollMs: 100,
      project: (message) => projectMessage(pool, projections, message),
    })
  }, 300_000)

  afterAll(async () => {
    await worker?.stop()
    await app?.close()
    await mongoClient?.close()
    await pool?.end()
    await postgres?.stop()
    await rabbit?.stop()
    await mongo?.stop()
  })

  it('rejects a catalog search that has no query', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalog/search',
      headers: await bearer(tenantId),
    })
    expect(response.statusCode).toBe(400)
  })

  it('searches one tenant and projects the catalog document', async () => {
    expect(await catalogStatus(tenantId, gloves.sku)).toBe(404)
    expect((await save(tenantId, gloves)).statusCode).toBe(200)
    expect((await save(tenantId, paper)).statusCode).toBe(200)

    const found = await app.inject({
      method: 'GET',
      url: '/v1/catalog/search?q=nitrile%20gloves',
      headers: await bearer(tenantId),
    })
    expect(found.statusCode).toBe(200)
    const results = found.json<{ results: { sku: string }[] }>().results
    expect(results[0]?.sku).toBe(gloves.sku)
    expect(results.map((row) => row.sku)).toContain(paper.sku)

    const hidden = await app.inject({
      method: 'GET',
      url: '/v1/catalog/search?q=nitrile%20gloves',
      headers: await bearer(otherTenantId),
    })
    expect(hidden.json<{ results: unknown[] }>().results).toEqual([])

    const document = await waitUntil(async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/catalog/${gloves.sku}`,
        headers: await bearer(tenantId),
      })
      if (response.statusCode !== 200) return null
      return response.json<{ name: string; tenantId: string }>()
    })
    expect(document.name).toBe(gloves.name)
    expect(document.tenantId).toBe(tenantId)
    expect(await catalogStatus(otherTenantId, gloves.sku)).toBe(404)
  })

  it('projects the order timeline and rebuilds both documents from Postgres', async () => {
    const stock = await app.inject({
      method: 'POST',
      url: '/v1/stock',
      headers: await bearer(tenantId),
      payload: { sku: gloves.sku, onHand: 10 },
    })
    expect(stock.statusCode).toBe(204)
    const placed = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: {
        ...(await bearer(tenantId)),
        'idempotency-key': randomUUID(),
      },
      payload: {
        currency: 'USD',
        lines: [{ sku: gloves.sku, quantity: 2, unitPriceCents: 499 }],
      },
    })
    expect(placed.statusCode).toBe(201)
    orderId = placed.json<{ orderId: string }>().orderId

    const timeline = await waitUntil(async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/orders/${orderId}/timeline`,
        headers: await bearer(tenantId),
      })
      if (response.statusCode !== 200) return null
      const body = response.json<{
        status: string
        events: { type: string }[]
      }>()
      return body.status === 'allocated' ? body : null
    })
    expect(timeline.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['OrderPlaced', 'PaymentCaptured']),
    )
    expect(await catalogStatus(otherTenantId, gloves.sku)).toBe(404)

    const database = mongoClient.db('meridian')
    await database.collection('catalog-content').deleteMany({})
    await database.collection('order-timeline').deleteMany({})
    expect(await catalogStatus(tenantId, gloves.sku)).toBe(404)

    const rebuilt = await app.inject({
      method: 'POST',
      url: '/v1/projections/rebuild',
      headers: await bearer(tenantId),
    })
    expect(rebuilt.statusCode).toBe(200)
    expect(
      rebuilt.json<{ catalog: number; timelines: number }>(),
    ).toEqual({
      catalog: 2,
      timelines: 1,
    })

    const catalog = await app.inject({
      method: 'GET',
      url: `/v1/catalog/${gloves.sku}`,
      headers: await bearer(tenantId),
    })
    expect(catalog.statusCode).toBe(200)
    expect(catalog.json<{ description: string }>().description).toBe(
      gloves.description,
    )
    const restored = await app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}/timeline`,
      headers: await bearer(tenantId),
    })
    expect(restored.statusCode).toBe(200)
    const body = restored.json<{ status: string; events: { type: string }[] }>()
    expect(body.status).toBe('allocated')
    expect(body.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['OrderPlaced', 'PaymentCaptured']),
    )
    expect(await catalogStatus(otherTenantId, gloves.sku)).toBe(404)
  })

  async function save(
    tenant: string,
    product: typeof gloves,
  ): Promise<{ statusCode: number }> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/catalog',
      headers: await bearer(tenant),
      payload: product,
    })
    return response
  }

  async function catalogStatus(tenant: string, sku: string): Promise<number> {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/catalog/${sku}`,
      headers: await bearer(tenant),
    })
    return response.statusCode
  }
})

async function waitUntil<T>(
  read: () => Promise<T | null>,
  timeoutMs = 15_000,
): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await read()
    if (value !== null && value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for the projection')
}
