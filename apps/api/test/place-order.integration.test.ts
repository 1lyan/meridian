import { createTestIdentity } from '@meridian/auth'
import { placeOrder as placeOrderDomain } from '@meridian/domain-ordering'
import { parseOrderId, parseTenantId } from '@meridian/kernel'
import {
  commitPlacedOrder,
  createDatabase,
  migrate,
} from '@meridian/persistence-pg'
import { startPostgres } from '@meridian/testkit'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

const body = {
  currency: 'USD',
  lines: [{ sku: 'GLV-100', quantity: 2, unitPriceCents: 499 }],
}

describe('POST /v1/orders', () => {
  let container!: Awaited<ReturnType<typeof startPostgres>>
  let pool!: Pool
  let app!: FastifyInstance
  let bearer!: (
    tenantId: string,
    extra?: Record<string, string>,
  ) => Promise<Record<string, string>>

  beforeAll(async () => {
    container = await startPostgres()
    pool = new Pool({ connectionString: container.getConnectionUri() })
    await migrate(pool)
    await migrate(pool)
    const identity = await createTestIdentity()
    bearer = async (tenantId, extra: Record<string, string> = {}) => ({
      authorization: `Bearer ${await identity.sign({ tenantId, subject: 'tester' })}`,
      ...extra,
    })
    app = await buildApp({
      pool,
      identity: identity.identity,
      now: () => new Date('2026-11-17T12:00:00.000Z'),
    })
  }, 300_000)

  afterAll(async () => {
    await app?.close()
    await pool?.end()
    await container?.stop()
  })

  it('commits the order, its lines, and one unpublished outbox row', async () => {
    const tenantId = crypto.randomUUID()
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: await bearer(tenantId, {
        'idempotency-key': 'place-1',
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      }),
      payload: body,
    })

    expect(response.statusCode).toBe(201)
    const placed = response.json<{
      orderId: string
      status: string
      version: number
    }>()
    expect(placed.status).toBe('placed')
    expect(placed.version).toBe(1)

    const orders = await pool.query(
      'select status, version from orders where id = $1 and tenant_id = $2',
      [placed.orderId, tenantId],
    )
    expect(orders.rows).toEqual([{ status: 'placed', version: 1 }])

    const lines = await pool.query(
      'select sku, quantity, unit_price_cents from order_lines where order_id = $1',
      [placed.orderId],
    )
    expect(lines.rows).toEqual([
      { sku: 'GLV-100', quantity: 2, unit_price_cents: 499 },
    ])

    const outbox = await pool.query(
      'select type, published_at, headers, payload from outbox where aggregate_id = $1',
      [placed.orderId],
    )
    expect(outbox.rows).toHaveLength(1)
    expect(outbox.rows[0].type).toBe('OrderPlaced')
    expect(outbox.rows[0].published_at).toBeNull()
    expect(outbox.rows[0].headers.traceparent).toBe(
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    )
    expect(outbox.rows[0].payload.orderId).toBe(placed.orderId)
  })

  it('replays the stored response and does not insert a second order', async () => {
    const tenantId = crypto.randomUUID()
    const headers = await bearer(tenantId, { 'idempotency-key': 'replay-1' })
    const first = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers,
      payload: body,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers,
      payload: body,
    })

    expect(second.statusCode).toBe(201)
    expect(second.headers['idempotent-replay']).toBe('true')
    expect(second.json()).toEqual(first.json())

    const count = await pool.query<{ n: number }>(
      'select count(*)::int as n from orders where tenant_id = $1',
      [tenantId],
    )
    expect(count.rows[0]?.n).toBe(1)
  })

  it('returns 409 when the same key is reused with a different body', async () => {
    const tenantId = crypto.randomUUID()
    const headers = await bearer(tenantId, { 'idempotency-key': 'conflict-1' })
    const first = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers,
      payload: body,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers,
      payload: {
        ...body,
        lines: [{ sku: 'GLV-100', quantity: 9, unitPriceCents: 499 }],
      },
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(409)
    expect(second.json()).toMatchObject({
      error: { code: 'idempotency_conflict' },
    })

    const count = await pool.query<{ n: number }>(
      'select count(*)::int as n from orders where tenant_id = $1',
      [tenantId],
    )
    expect(count.rows[0]?.n).toBe(1)
  })

  it('keeps idempotency keys inside the tenant', async () => {
    const key = 'shared-key'
    const first = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: await bearer(crypto.randomUUID(), { 'idempotency-key': key }),
      payload: body,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: await bearer(crypto.randomUUID(), { 'idempotency-key': key }),
      payload: body,
    })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(first.json().orderId).not.toBe(second.json().orderId)
  })

  it('rolls the new idempotency key back when the order row already exists', async () => {
    const tenantRaw = crypto.randomUUID()
    const tenantId = parseTenantId(tenantRaw)
    const created = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: await bearer(tenantRaw, { 'idempotency-key': 'original' }),
      payload: body,
    })
    expect(created.statusCode).toBe(201)
    const orderId = parseOrderId(created.json<{ orderId: string }>().orderId)
    const placed = placeOrderDomain({
      tenantId,
      orderId,
      currency: 'USD',
      lines: body.lines,
      now: new Date('2026-11-17T12:00:00.000Z'),
    })

    await expect(
      commitPlacedOrder(createDatabase(pool), {
        order: placed.order,
        event: placed.event,
        idempotencyKey: 'second-key',
        requestHash: 'b'.repeat(64),
        responseStatus: 201,
        responseBody: {
          orderId,
          tenantId: tenantRaw,
          status: 'placed',
          version: 1,
        },
        headers: { tenantId: tenantRaw, requestId: 'rollback-test' },
        actorId: 'tester',
      }),
    ).rejects.toThrow()

    const keys = await pool.query<{ key: string }>(
      'select key from idempotency_keys where tenant_id = $1 order by key',
      [tenantRaw],
    )
    const messages = await pool.query<{ n: number }>(
      'select count(*)::int as n from outbox where tenant_id = $1',
      [tenantRaw],
    )
    expect(keys.rows.map((row) => row.key)).toEqual(['original'])
    expect(messages.rows[0]?.n).toBe(1)
  })

  it('rejects a missing token, a bad token, and an empty order without writing', async () => {
    const tenantId = crypto.randomUUID()
    const missingToken = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { 'idempotency-key': 'k' },
      payload: body,
    })
    const badToken = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { authorization: 'Bearer not-a-token', 'idempotency-key': 'k' },
      payload: body,
    })
    const empty = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: await bearer(tenantId, { 'idempotency-key': 'empty' }),
      payload: { currency: 'USD', lines: [] },
    })

    expect(missingToken.statusCode).toBe(401)
    expect(badToken.statusCode).toBe(401)
    expect(empty.statusCode).toBe(400)

    const count = await pool.query<{ n: number }>(
      'select count(*)::int as n from orders where tenant_id = $1',
      [tenantId],
    )
    expect(count.rows[0]?.n).toBe(0)
  })

  it('serves health after migrations have been applied', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', postgres: 'ok' })
  })

  it('lets one of two concurrent identical requests win and stores a single order', async () => {
    const tenantId = crypto.randomUUID()
    const headers = await bearer(tenantId, { 'idempotency-key': 'race-1' })
    const [left, right] = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/orders', headers, payload: body }),
      app.inject({ method: 'POST', url: '/v1/orders', headers, payload: body }),
    ])

    expect([left.statusCode, right.statusCode]).toEqual([201, 201])
    const replays = [
      left.headers['idempotent-replay'],
      right.headers['idempotent-replay'],
    ].filter((value) => value === 'true')
    expect(replays).toHaveLength(1)
    expect(left.json()).toEqual(right.json())

    const count = await pool.query<{ n: number }>(
      'select count(*)::int as n from orders where tenant_id = $1',
      [tenantId],
    )
    const outbox = await pool.query<{ n: number }>(
      'select count(*)::int as n from outbox where tenant_id = $1',
      [tenantId],
    )
    expect(count.rows[0]?.n).toBe(1)
    expect(outbox.rows[0]?.n).toBe(1)
  })
})
