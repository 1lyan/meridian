import {
  type OrderSnapshot,
  onInventoryRejected,
  onInventoryReserved,
  onPaymentCaptured,
  onPaymentFailed,
  type SagaDecision,
} from '@meridian/domain-ordering'
import { parseTenantId } from '@meridian/kernel'
import { consumers } from '@meridian/messaging'
import {
  appendCommands,
  appendOutbox,
  loadOrder,
  recordCapture,
  releaseForOrder,
  reserveForOrder,
  transitionOrder,
  withInbox,
} from '@meridian/persistence-pg'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import type { PaymentPort } from './payment.js'

const line = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
})

const orderRef = z.object({
  orderId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

const orderFact = orderRef.extend({
  lines: z.array(line).min(1),
})

const collectPayment = orderRef.extend({
  amountCents: z.number().int().nonnegative(),
  paymentOutcome: z.enum(['capture', 'decline']),
})

const incomingMessage = z.object({
  messageId: z.string().uuid(),
  type: z.string(),
  payload: z.unknown(),
  headers: z.record(z.unknown()).optional(),
})

export type IncomingMessage = z.infer<typeof incomingMessage>

export async function dispatch(
  pool: Pool,
  message: IncomingMessage,
  payment: PaymentPort,
): Promise<void> {
  const headers = message.headers ?? {}
  switch (message.type) {
    case 'OrderPlaced':
      return handleOrderPlaced(pool, message, headers)
    case 'InventoryReserved':
    case 'InventoryRejected':
    case 'PaymentCaptured':
    case 'PaymentFailed':
      return handleProcess(pool, message, headers)
    case 'CollectPayment':
      return handleCollectPayment(pool, message, headers, payment)
    case 'ReleaseReservation':
      return handleRelease(pool, message)
    case 'CatalogUpserted':
      return
    default:
      throw new Error(`Unhandled message type ${message.type}`)
  }
}

export function parseIncoming(content: Buffer): IncomingMessage {
  return incomingMessage.parse(JSON.parse(content.toString()))
}

async function handleOrderPlaced(
  pool: Pool,
  message: IncomingMessage,
  headers: Record<string, unknown>,
): Promise<void> {
  const fact = orderFact.parse(message.payload)
  const tenantId = parseTenantId(fact.tenantId)
  await withInbox(
    pool,
    consumers.inventory,
    message.messageId,
    async (client) => {
      const outcome = await reserveForOrder(
        client,
        tenantId,
        fact.orderId,
        fact.lines,
      )
      const type =
        outcome === 'reserved' ? 'InventoryReserved' : 'InventoryRejected'
      const payload =
        outcome === 'reserved'
          ? {
              type,
              orderId: fact.orderId,
              tenantId: fact.tenantId,
              lines: fact.lines,
            }
          : {
              type,
              orderId: fact.orderId,
              tenantId: fact.tenantId,
              reason: 'insufficient_stock' as const,
            }
      await appendOutbox(client, {
        tenantId,
        aggregateType: 'order',
        aggregateId: fact.orderId,
        type,
        payload,
        headers,
      })
    },
  )
}

async function handleProcess(
  pool: Pool,
  message: IncomingMessage,
  headers: Record<string, unknown>,
): Promise<void> {
  const fact = orderRef.parse(message.payload)
  const decide = decisionFor(message.type)
  await withInbox(
    pool,
    consumers.processManager,
    message.messageId,
    async (client) => {
      await applyDecision(client, fact.tenantId, fact.orderId, decide, headers)
    },
  )
}

async function handleCollectPayment(
  pool: Pool,
  message: IncomingMessage,
  headers: Record<string, unknown>,
  payment: PaymentPort,
): Promise<void> {
  const command = collectPayment.parse(message.payload)
  const tenantId = parseTenantId(command.tenantId)
  const result = await payment.capture({
    orderId: command.orderId,
    amountCents: command.amountCents,
    outcome: command.paymentOutcome,
  })
  await withInbox(
    pool,
    consumers.billing,
    message.messageId,
    async (client) => {
      if (result === 'captured') {
        await recordCapture(
          client,
          tenantId,
          command.orderId,
          command.amountCents,
        )
      }
      await appendOutbox(client, {
        tenantId,
        aggregateType: 'order',
        aggregateId: command.orderId,
        type: result === 'captured' ? 'PaymentCaptured' : 'PaymentFailed',
        payload: {
          type: result === 'captured' ? 'PaymentCaptured' : 'PaymentFailed',
          orderId: command.orderId,
          tenantId: command.tenantId,
        },
        headers,
      })
    },
  )
}

async function handleRelease(
  pool: Pool,
  message: IncomingMessage,
): Promise<void> {
  const fact = orderRef.parse(message.payload)
  await withInbox(
    pool,
    consumers.inventory,
    message.messageId,
    async (client) => {
      await releaseForOrder(client, fact.tenantId, fact.orderId)
    },
  )
}

function decisionFor(type: string): (order: OrderSnapshot) => SagaDecision {
  switch (type) {
    case 'InventoryReserved':
      return onInventoryReserved
    case 'InventoryRejected':
      return onInventoryRejected
    case 'PaymentCaptured':
      return onPaymentCaptured
    case 'PaymentFailed':
      return onPaymentFailed
    default:
      throw new Error(`No process decision for ${type}`)
  }
}

async function applyDecision(
  client: PoolClient,
  tenantId: string,
  orderId: string,
  decide: (order: OrderSnapshot) => SagaDecision,
  headers: Record<string, unknown>,
): Promise<void> {
  const order = await loadOrder(client, tenantId, orderId)
  if (!order) throw new Error(`Order ${orderId} does not exist`)
  const decision = decide(order)
  if (decision.kind === 'ignore') return
  const applied = await transitionOrder(
    client,
    order,
    decision.status,
    decision.rejectionReason,
  )
  if (!applied) {
    const reloaded = await loadOrder(client, tenantId, orderId)
    if (!reloaded) return
    const again = decide(reloaded)
    if (again.kind === 'ignore') return
    const retried = await transitionOrder(
      client,
      reloaded,
      again.status,
      again.rejectionReason,
    )
    if (!retried) return
    await appendCommands(client, again.commands, headers)
    return
  }
  await appendCommands(client, decision.commands, headers)
}
