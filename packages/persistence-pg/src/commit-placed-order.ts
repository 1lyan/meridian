import { randomUUID } from 'node:crypto'
import type { OrderPlaced, PlacedOrder } from '@meridian/domain-ordering'
import { and, eq } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { IdempotencyConflictError } from './errors.js'
import {
  idempotencyKeys,
  orderLines,
  orders,
  outbox,
  schema,
} from './schema.js'

export function createDatabase(pool: Pool) {
  return drizzle(pool, { schema })
}

export type Database = NodePgDatabase<typeof schema>

export type CommitPlacedInput = {
  order: PlacedOrder
  event: OrderPlaced
  idempotencyKey: string
  requestHash: string
  responseStatus: number
  responseBody: unknown
  headers: {
    tenantId: string
    requestId: string
    traceparent?: string
  }
}

export type CommitPlacedResult =
  | { outcome: 'created' }
  | { outcome: 'replayed'; responseStatus: number; responseBody: unknown }

export async function commitPlacedOrder(
  db: Database,
  input: CommitPlacedInput,
): Promise<CommitPlacedResult> {
  try {
    return await commitOnce(db, input)
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    return await commitOnce(db, input)
  }
}

async function commitOnce(
  db: Database,
  input: CommitPlacedInput,
): Promise<CommitPlacedResult> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.tenantId, input.order.tenantId),
          eq(idempotencyKeys.key, input.idempotencyKey),
        ),
      )
      .for('update')

    const row = existing[0]
    if (row) {
      if (row.requestHash !== input.requestHash)
        throw new IdempotencyConflictError()
      return {
        outcome: 'replayed' as const,
        responseStatus: row.responseStatus,
        responseBody: row.responseBody,
      }
    }

    await tx.insert(orders).values({
      id: input.order.id,
      tenantId: input.order.tenantId,
      status: input.order.status,
      currency: input.order.currency,
      version: input.order.version,
      createdAt: input.order.createdAt,
    })

    await tx.insert(orderLines).values(
      input.order.lines.map((line) => ({
        id: randomUUID(),
        orderId: input.order.id,
        tenantId: input.order.tenantId,
        sku: line.sku,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      })),
    )

    const headers: Record<string, string> = {
      tenantId: input.headers.tenantId,
      requestId: input.headers.requestId,
    }
    if (input.headers.traceparent !== undefined)
      headers.traceparent = input.headers.traceparent

    await tx.insert(outbox).values({
      id: randomUUID(),
      tenantId: input.order.tenantId,
      aggregateType: 'order',
      aggregateId: input.order.id,
      type: input.event.type,
      payload: {
        type: input.event.type,
        orderId: input.event.orderId,
        tenantId: input.event.tenantId,
        currency: input.event.currency,
        lines: input.event.lines,
        occurredAt: input.event.occurredAt.toISOString(),
        version: input.event.version,
      },
      headers,
      createdAt: input.order.createdAt,
    })

    await tx.insert(idempotencyKeys).values({
      tenantId: input.order.tenantId,
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
      createdAt: input.order.createdAt,
    })

    return { outcome: 'created' as const }
  })
}

function isUniqueViolation(error: unknown): boolean {
  return (
    postgresCode(error) === '23505' || postgresCode(causedBy(error)) === '23505'
  )
}

function causedBy(error: unknown): unknown {
  return error instanceof Error ? error.cause : undefined
}

function postgresCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return undefined
}
