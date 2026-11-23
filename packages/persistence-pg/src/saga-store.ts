import { randomUUID } from 'node:crypto'
import { type JournalEntry, journalForCapture } from '@meridian/domain-billing'
import { defaultWarehouseId } from '@meridian/domain-inventory'
import type {
  OrderLine,
  OrderSnapshot,
  OrderStatus,
  PaymentOutcome,
  RejectionReason,
  SagaCommand,
} from '@meridian/domain-ordering'
import { parseOrderId, parseTenantId, type TenantId } from '@meridian/kernel'
import type { Pool, PoolClient } from 'pg'

export type OutboxRow = {
  id: string
  tenantId: string
  aggregateType: string
  aggregateId: string
  type: string
  payload: unknown
  headers: Record<string, unknown>
}

type Queryable = Pool | PoolClient

export async function withInbox<T>(
  pool: Pool,
  consumer: string,
  messageId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<{ status: 'duplicate' } | { status: 'done'; value: T }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO inbox (consumer, message_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING message_id`,
      [consumer, messageId],
    )
    if (inserted.rowCount === 0) {
      await client.query('COMMIT')
      return { status: 'duplicate' }
    }
    const value = await work(client)
    await client.query('COMMIT')
    return { status: 'done', value }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function publishPending(
  pool: Pool,
  publish: (row: OutboxRow) => Promise<void>,
  limit = 20,
): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const claimed = await client.query<{
      id: string
      tenant_id: string
      aggregate_type: string
      aggregate_id: string
      type: string
      payload: unknown
      headers: Record<string, unknown> | null
    }>(
      `SELECT id, tenant_id, aggregate_type, aggregate_id, type, payload, headers
       FROM outbox
       WHERE published_at IS NULL
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [limit],
    )
    for (const row of claimed.rows) {
      await publish({
        id: row.id,
        tenantId: row.tenant_id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        type: row.type,
        payload: row.payload,
        headers: row.headers ?? {},
      })
    }
    if (claimed.rows.length > 0) {
      await client.query(
        `UPDATE outbox SET published_at = now() WHERE id = ANY($1::uuid[])`,
        [claimed.rows.map((row) => row.id)],
      )
    }
    await client.query('COMMIT')
    return claimed.rows.length
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function loadOrder(
  client: Queryable,
  tenantId: string,
  orderId: string,
): Promise<OrderSnapshot | null> {
  const order = await client.query<{
    id: string
    tenant_id: string
    status: OrderStatus
    version: number
    payment_outcome: PaymentOutcome
    rejection_reason: RejectionReason | null
  }>(
    `SELECT id, tenant_id, status, version, payment_outcome, rejection_reason
     FROM orders
     WHERE id = $1 AND tenant_id = $2`,
    [orderId, tenantId],
  )
  const row = order.rows[0]
  if (!row) return null
  const lines = await client.query<{
    sku: string
    quantity: number
    unit_price_cents: number
  }>(
    `SELECT sku, quantity, unit_price_cents
     FROM order_lines
     WHERE order_id = $1
     ORDER BY sku`,
    [orderId],
  )
  return {
    id: parseOrderId(row.id),
    tenantId: parseTenantId(row.tenant_id),
    status: row.status,
    version: row.version,
    paymentOutcome: row.payment_outcome,
    rejectionReason: row.rejection_reason,
    lines: lines.rows.map((line) => ({
      sku: line.sku,
      quantity: line.quantity,
      unitPriceCents: line.unit_price_cents,
    })),
  }
}

export async function transitionOrder(
  client: PoolClient,
  order: OrderSnapshot,
  status: OrderStatus,
  rejectionReason: RejectionReason | null,
): Promise<boolean> {
  const updated = await client.query(
    `UPDATE orders
     SET status = $3, version = version + 1, rejection_reason = $4
     WHERE id = $1 AND tenant_id = $2 AND version = $5`,
    [order.id, order.tenantId, status, rejectionReason, order.version],
  )
  return updated.rowCount === 1
}

export async function appendOutbox(
  client: PoolClient,
  input: {
    tenantId: TenantId
    aggregateType: string
    aggregateId: string
    type: string
    payload: unknown
    headers: Record<string, unknown>
  },
): Promise<void> {
  await client.query(
    `INSERT INTO outbox
       (id, tenant_id, aggregate_type, aggregate_id, type, payload, headers, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, now())`,
    [
      randomUUID(),
      input.tenantId,
      input.aggregateType,
      input.aggregateId,
      input.type,
      JSON.stringify(input.payload),
      JSON.stringify(input.headers),
    ],
  )
}

export async function appendCommands(
  client: PoolClient,
  commands: readonly SagaCommand[],
  headers: Record<string, unknown>,
): Promise<void> {
  for (const command of commands) {
    await appendOutbox(client, {
      tenantId: command.tenantId,
      aggregateType: 'order',
      aggregateId: command.orderId,
      type: command.type,
      payload: command,
      headers,
    })
  }
}

export async function receiveStock(
  pool: Pool,
  input: {
    tenantId: string
    sku: string
    onHand: number
    warehouseId?: string
  },
): Promise<void> {
  const warehouseId = input.warehouseId ?? defaultWarehouseId
  await pool.query(
    `INSERT INTO stock_items (tenant_id, sku, warehouse_id, on_hand, reserved, version)
     VALUES ($1, $2, $3, $4, 0, 0)
     ON CONFLICT (tenant_id, sku, warehouse_id)
     DO UPDATE SET on_hand = stock_items.on_hand + EXCLUDED.on_hand,
                   version = stock_items.version + 1`,
    [input.tenantId, input.sku, warehouseId, input.onHand],
  )
}

type LockedStock = {
  warehouse_id: string
  on_hand: number
  reserved: number
}

export async function reserveForOrder(
  client: PoolClient,
  tenantId: TenantId,
  orderId: string,
  lines: readonly OrderLine[],
): Promise<'reserved' | 'insufficient_stock'> {
  const chosen: { line: OrderLine; warehouseId: string }[] = []
  for (const line of lines) {
    const rows = await client.query<LockedStock>(
      `SELECT warehouse_id, on_hand, reserved
       FROM stock_items
       WHERE tenant_id = $1 AND sku = $2
       ORDER BY warehouse_id
       FOR UPDATE`,
      [tenantId, line.sku],
    )
    const fit = rows.rows.find(
      (row) => row.on_hand - row.reserved >= line.quantity,
    )
    if (!fit) return 'insufficient_stock'
    chosen.push({ line, warehouseId: fit.warehouse_id })
  }

  for (const { line, warehouseId } of chosen) {
    await client.query(
      `UPDATE stock_items
       SET reserved = reserved + $4, version = version + 1
       WHERE tenant_id = $1 AND sku = $2 AND warehouse_id = $3`,
      [tenantId, line.sku, warehouseId, line.quantity],
    )
    await client.query(
      `INSERT INTO reservations
         (id, tenant_id, order_id, sku, warehouse_id, quantity, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'held')`,
      [randomUUID(), tenantId, orderId, line.sku, warehouseId, line.quantity],
    )
  }
  return 'reserved'
}

export async function releaseForOrder(
  client: PoolClient,
  tenantId: string,
  orderId: string,
): Promise<void> {
  const held = await client.query<{
    sku: string
    warehouse_id: string
    quantity: number
  }>(
    `UPDATE reservations
     SET status = 'released'
     WHERE tenant_id = $1 AND order_id = $2 AND status = 'held'
     RETURNING sku, warehouse_id, quantity`,
    [tenantId, orderId],
  )
  for (const row of held.rows) {
    const updated = await client.query(
      `UPDATE stock_items
       SET reserved = reserved - $4, version = version + 1
       WHERE tenant_id = $1 AND sku = $2 AND warehouse_id = $3
         AND reserved >= $4`,
      [tenantId, row.sku, row.warehouse_id, row.quantity],
    )
    if (updated.rowCount !== 1) {
      throw new Error(`Reserved stock missing for ${row.sku}`)
    }
  }
}

export async function recordCapture(
  client: PoolClient,
  tenantId: TenantId,
  orderId: string,
  amountCents: number,
): Promise<void> {
  const entry: JournalEntry = journalForCapture(tenantId, amountCents)
  const journalId = randomUUID()
  await client.query(
    `INSERT INTO journal_entries (id, tenant_id, order_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [journalId, tenantId, orderId],
  )
  for (const line of entry.lines) {
    await client.query(
      `INSERT INTO postings (id, journal_id, account, amount_cents)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), journalId, line.account, line.amountCents],
    )
  }
}

export async function rejectExpiredPlacedOrders(
  pool: Pool,
  now: Date,
  timeoutMs: number,
): Promise<number> {
  const deadline = new Date(now.getTime() - timeoutMs)
  const result = await pool.query(
    `UPDATE orders
     SET status = 'rejected',
         rejection_reason = 'reservation_timeout',
         version = version + 1
     WHERE status = 'placed' AND created_at < $1`,
    [deadline],
  )
  return result.rowCount ?? 0
}

export async function countUnpublished(
  pool: Pool,
  tenantId: string,
): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM outbox
     WHERE tenant_id = $1 AND published_at IS NULL`,
    [tenantId],
  )
  return result.rows[0]?.n ?? 0
}
