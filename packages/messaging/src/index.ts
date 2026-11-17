/** Names the phase 1 relay will declare. Quorum queues, confirms, and a dead-letter queue. */
export const exchanges = {
  orders: 'commerce.order',
  unroutable: 'commerce.unroutable',
} as const

export const routingKeys = {
  orderPlaced: 'order.placed',
} as const

export const queues = {
  orderProcess: 'commerce.order.process',
  orderDeadLetter: 'commerce.order.dead-letter',
} as const
