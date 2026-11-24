import { randomUUID } from 'node:crypto'
import { buildApp } from '@meridian/api/app'
import { createTestIdentity } from '@meridian/auth'
import { queues } from '@meridian/messaging'
import {
  countUnpublished,
  migrate,
  publishPending,
} from '@meridian/persistence-pg'
import { startPostgres, startRabbit } from '@meridian/testkit'
import {
  dispatch,
  scriptedPayment,
  startWorker,
  type Worker,
} from '@meridian/worker'
import amqp from 'amqplib'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const line = { sku: 'GLV-100', quantity: 2, unitPriceCents: 499 }

describe('order saga', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>
  let rabbit: Awaited<ReturnType<typeof startRabbit>>
  let pool: Pool
  let app: Awaited<ReturnType<typeof buildApp>>
  let worker: Worker
  let bearer!: (
    tenantId: string,
    extra?: Record<string, string>,
  ) => Promise<Record<string, string>>

  beforeAll(async () => {
    postgres = await startPostgres()
    rabbit = await startRabbit()
    pool = new Pool({ connectionString: postgres.getConnectionUri() })
    await migrate(pool)
    const identity = await createTestIdentity()
    bearer = async (tenantId, extra = {}) => ({
      authorization: `Bearer ${await identity.sign({ tenantId, subject: 'tester' })}`,
      ...extra,
    })
    app = await buildApp({ pool, identity: identity.identity })
    worker = await startWorker({
      pool,
      rabbitUrl: rabbit.getAmqpUrl(),
      reservationTimeoutMs: 60_000,
      pollMs: 100,
    })
  }, 300_000)

  afterAll(async () => {
    await worker?.stop()
    await app?.close()
    await pool?.end()
    await postgres?.stop()
    await rabbit?.stop()
  })

  it('allocates a funded order and publishes every outbox row', async () => {
    const tenantId = randomUUID()
    await receive(tenantId, 10)
    const orderId = await place(tenantId)
    const view = await waitFor(orderId, tenantId, 'allocated')

    expect(view.version).toBeGreaterThan(1)
    expect(await reserved(tenantId)).toBe(2)
    expect(await journalSum(orderId)).toBe(0)
    expect(await journalCount(orderId)).toBe(1)
    await waitUntil(async () => (await countUnpublished(pool, tenantId)) === 0)
  })

  it('releases the reservation when payment declines', async () => {
    const tenantId = randomUUID()
    await receive(tenantId, 10)
    const orderId = await place(tenantId, 'decline')
    const view = await waitFor(orderId, tenantId, 'rejected')

    expect(view.rejectionReason).toBe('payment_declined')
    const statuses = await waitUntil(async () => {
      const reservations = await pool.query<{ status: string }>(
        'select status from reservations where order_id = $1',
        [orderId],
      )
      const rows = reservations.rows.map((row) => row.status)
      return rows.length === 1 && rows[0] === 'released' ? rows : null
    })
    expect(statuses).toEqual(['released'])
    expect(await reserved(tenantId)).toBe(0)
    expect(await journalCount(orderId)).toBe(0)
  })

  it('rejects the order when stock cannot cover it', async () => {
    const tenantId = randomUUID()
    await receive(tenantId, 1)
    const orderId = await place(tenantId)
    const view = await waitFor(orderId, tenantId, 'rejected')
    expect(view.rejectionReason).toBe('insufficient_stock')
    expect(await reserved(tenantId)).toBe(0)
  })

  it('treats a second delivery of the same message as a no-op', async () => {
    const tenantId = randomUUID()
    await receive(tenantId, 10)
    const orderId = await place(tenantId)
    await waitFor(orderId, tenantId, 'allocated')
    const reservedBefore = await reserved(tenantId)
    const versionBefore = (await readOrder(orderId, tenantId)).version

    const stored = await pool.query<{
      id: string
      payload: unknown
      headers: Record<string, unknown>
    }>(
      `select id, payload, headers from outbox
       where aggregate_id = $1 and type = 'InventoryReserved'`,
      [orderId],
    )
    const message = stored.rows[0]
    expect(message).toBeDefined()
    if (!message) return
    await dispatch(
      pool,
      {
        messageId: message.id,
        type: 'InventoryReserved',
        payload: message.payload,
        headers: message.headers,
      },
      scriptedPayment(),
    )

    expect(await reserved(tenantId)).toBe(reservedBefore)
    expect((await readOrder(orderId, tenantId)).version).toBe(versionBefore)
    const inbox = await pool.query<{ n: number }>(
      'select count(*)::int as n from inbox where message_id = $1',
      [message.id],
    )
    expect(inbox.rows[0]?.n).toBe(1)
  })

  it('dead-letters a poison message once the attempt budget is spent', async () => {
    await worker.publish('order.placed', Buffer.from('not-json'), {
      attempt: 3,
    })
    const connection = await amqp.connect(rabbit.getAmqpUrl())
    const channel = await connection.createChannel()
    try {
      const dead = await waitUntil(async () => {
        const got = await channel.get(queues.orderDeadLetter, { noAck: true })
        return got === false ? null : got
      })
      expect(dead).toBeTruthy()
    } finally {
      await channel.close()
      await connection.close()
    }
  })

  it('times out a placed order that nobody reserves', async () => {
    const tenantId = randomUUID()
    const orderId = randomUUID()
    await pool.query(
      `insert into orders (id, tenant_id, status, currency, version, payment_outcome, created_at)
       values ($1, $2, 'placed', 'USD', 1, 'capture', now() - interval '5 minutes')`,
      [orderId, tenantId],
    )
    const view = await waitUntil(async () => {
      const current = await readOrder(orderId, tenantId)
      return current.status === 'rejected' ? current : null
    })
    expect(view.rejectionReason).toBe('reservation_timeout')
  })

  it('leaves the outbox unpublished when the broker publish fails', async () => {
    await worker.stop()
    const tenantId = randomUUID()
    const id = randomUUID()
    await pool.query(
      `insert into outbox (id, tenant_id, aggregate_type, aggregate_id, type, payload, headers, created_at)
       values ($1, $2, 'order', $3, 'OrderPlaced', '{}', '{}', now())`,
      [id, tenantId, randomUUID()],
    )
    await expect(
      publishPending(pool, async (row) => {
        if (row.id === id) throw new Error('broker down')
      }),
    ).rejects.toThrow('broker down')
    const pending = await pool.query(
      'select published_at from outbox where id = $1',
      [id],
    )
    expect(pending.rows[0]?.published_at).toBeNull()
  })

  async function receive(tenantId: string, onHand: number) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/stock',
      headers: await bearer(tenantId),
      payload: { sku: line.sku, onHand },
    })
    expect(response.statusCode).toBe(204)
  }

  async function place(tenantId: string, paymentOutcome = 'capture') {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: {
        ...(await bearer(tenantId)),
        'idempotency-key': randomUUID(),
      },
      payload: { currency: 'USD', paymentOutcome, lines: [line] },
    })
    expect(response.statusCode).toBe(201)
    return response.json<{ orderId: string }>().orderId
  }

  async function readOrder(orderId: string, tenantId: string) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: await bearer(tenantId),
    })
    expect(response.statusCode).toBe(200)
    return response.json<{
      status: string
      version: number
      rejectionReason: string | null
    }>()
  }

  async function waitFor(orderId: string, tenantId: string, status: string) {
    return waitUntil(async () => {
      const view = await readOrder(orderId, tenantId)
      return view.status === status ? view : null
    })
  }

  async function reserved(tenantId: string) {
    const result = await pool.query<{ reserved: number }>(
      'select reserved from stock_items where tenant_id = $1 and sku = $2',
      [tenantId, line.sku],
    )
    return result.rows[0]?.reserved ?? 0
  }

  async function journalSum(orderId: string) {
    const result = await pool.query<{ total: number }>(
      `select coalesce(sum(p.amount_cents), 0)::int as total
       from postings p
       join journal_entries j on j.id = p.journal_id
       where j.order_id = $1`,
      [orderId],
    )
    return result.rows[0]?.total ?? 0
  }

  async function journalCount(orderId: string) {
    const result = await pool.query<{ n: number }>(
      'select count(*)::int as n from journal_entries where order_id = $1',
      [orderId],
    )
    return result.rows[0]?.n ?? 0
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
  throw new Error('timed out waiting for the saga')
}
