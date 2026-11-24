/** Broker names for the order saga. Quorum queues, confirms, and a dead-letter queue. */
export const exchanges = {
  orders: 'commerce.order',
  unroutable: 'commerce.unroutable',
  retry: 'commerce.order.retry',
  deadLetter: 'commerce.order.dlx',
} as const

export const routingKeys = {
  orderPlaced: 'order.placed',
  inventoryReserved: 'inventory.reserved',
  inventoryRejected: 'inventory.rejected',
  collectPayment: 'billing.collect',
  paymentCaptured: 'payment.captured',
  paymentFailed: 'payment.failed',
  releaseReservation: 'inventory.release',
  catalogUpserted: 'catalog.upserted',
} as const

export const queues = {
  orderProcess: 'commerce.order.process',
  orderRetry: 'commerce.order.retry',
  orderDeadLetter: 'commerce.order.dead-letter',
  unroutable: 'commerce.unroutable.capture',
} as const

export const routingKeyByType = {
  OrderPlaced: routingKeys.orderPlaced,
  InventoryReserved: routingKeys.inventoryReserved,
  InventoryRejected: routingKeys.inventoryRejected,
  CollectPayment: routingKeys.collectPayment,
  PaymentCaptured: routingKeys.paymentCaptured,
  PaymentFailed: routingKeys.paymentFailed,
  ReleaseReservation: routingKeys.releaseReservation,
  CatalogUpserted: routingKeys.catalogUpserted,
} as const

export type OutboxMessageType = keyof typeof routingKeyByType

export function routingKeyFor(type: string): string {
  if (type in routingKeyByType) {
    return routingKeyByType[type as OutboxMessageType]
  }
  throw new Error(`No routing key for outbox type ${type}`)
}

export const consumers = {
  inventory: 'inventory',
  processManager: 'process-manager',
  billing: 'billing',
} as const

export const maxDeliveryAttempts = 3

export function decideDisposition(attempt: number): 'retry' | 'dead-letter' {
  return attempt >= maxDeliveryAttempts ? 'dead-letter' : 'retry'
}

/** Attempt 0 waits 1s, then 5s, then 15s, then the next failure is dead-lettered. */
export function retryTtlMs(attempt: number): number {
  const ladder = [1000, 5000, 15_000] as const
  return ladder[attempt] ?? 15_000
}
