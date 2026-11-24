import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Typed query surface for migrations 0001 and 0002. Column names must match those files.
 * Migration 0003 stores catalog embeddings as `vector(32)`, which stays in SQL.
 * Checks and foreign keys are enforced by the SQL migration, which is what runs.
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    status: text('status').notNull(),
    currency: text('currency').notNull(),
    version: integer('version').notNull(),
    paymentOutcome: text('payment_outcome').notNull(),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
  },
  (table) => [unique('orders_id_tenant_uniq').on(table.id, table.tenantId)],
)

export const orderLines = pgTable(
  'order_lines',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    sku: text('sku').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
  },
  (table) => [
    unique('order_lines_order_sku_uniq').on(table.orderId, table.sku),
  ],
)

export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  headers: jsonb('headers').notNull(),
  createdAt: timestamp('created_at', {
    withTimezone: true,
    mode: 'date',
  }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
})

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.key] })],
)

export const schema = { orders, orderLines, outbox, idempotencyKeys }
