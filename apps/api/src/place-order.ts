import {
  type PlaceOrderBody,
  type PlaceOrderResponse,
  placeOrderResponse,
} from '@meridian/contracts'
import { placeOrder as placeOrderDomain } from '@meridian/domain-ordering'
import { newOrderId, type TenantId } from '@meridian/kernel'
import { commitPlacedOrder, type Database } from '@meridian/persistence-pg'
import { hashRequestBody } from './hash-body.js'

export type PlaceOrderInput = {
  tenantId: TenantId
  body: PlaceOrderBody
  idempotencyKey: string
  now: Date
  requestId: string
  traceparent?: string
}

export type PlaceOrderResult = {
  responseStatus: number
  responseBody: PlaceOrderResponse
  replayed: boolean
}

export async function placeOrder(
  db: Database,
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  const orderId = newOrderId()
  const placed = placeOrderDomain({
    tenantId: input.tenantId,
    orderId,
    currency: input.body.currency,
    lines: input.body.lines,
    now: input.now,
  })

  const responseBody: PlaceOrderResponse = {
    orderId: placed.order.id,
    tenantId: placed.order.tenantId,
    status: placed.order.status,
    version: placed.order.version,
  }

  const headers = {
    tenantId: input.tenantId,
    requestId: input.requestId,
    ...(input.traceparent !== undefined
      ? { traceparent: input.traceparent }
      : {}),
  }

  const committed = await commitPlacedOrder(db, {
    order: placed.order,
    event: placed.event,
    idempotencyKey: input.idempotencyKey,
    requestHash: hashRequestBody(input.body),
    responseStatus: 201,
    responseBody,
    headers,
  })

  if (committed.outcome === 'created') {
    return { responseStatus: 201, responseBody, replayed: false }
  }

  const stored = placeOrderResponse.parse(committed.responseBody)
  return {
    responseStatus: committed.responseStatus,
    responseBody: stored,
    replayed: true,
  }
}
