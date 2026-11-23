import type { OrderId, TenantId } from '@meridian/kernel'
import type { OrderLine, PaymentOutcome } from './place-order.js'

export type OrderStatus = 'placed' | 'reserved' | 'allocated' | 'rejected'
export type RejectionReason =
  | 'insufficient_stock'
  | 'payment_declined'
  | 'reservation_timeout'

export type OrderSnapshot = {
  id: OrderId
  tenantId: TenantId
  status: OrderStatus
  version: number
  lines: readonly OrderLine[]
  paymentOutcome: PaymentOutcome
  rejectionReason: RejectionReason | null
}

export type SagaCommand =
  | {
      type: 'CollectPayment'
      orderId: OrderId
      tenantId: TenantId
      amountCents: number
      paymentOutcome: PaymentOutcome
    }
  | {
      type: 'ReleaseReservation'
      orderId: OrderId
      tenantId: TenantId
      lines: readonly OrderLine[]
    }

export type SagaDecision =
  | { kind: 'ignore' }
  | {
      kind: 'transition'
      expectedVersion: number
      status: OrderStatus
      rejectionReason: RejectionReason | null
      commands: readonly SagaCommand[]
    }

export function orderAmountCents(lines: readonly OrderLine[]): number {
  return lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPriceCents,
    0,
  )
}

export function onInventoryReserved(order: OrderSnapshot): SagaDecision {
  if (order.status === 'rejected') {
    return {
      kind: 'transition',
      expectedVersion: order.version,
      status: order.status,
      rejectionReason: order.rejectionReason,
      commands: [release(order)],
    }
  }
  if (order.status !== 'placed') return { kind: 'ignore' }
  return {
    kind: 'transition',
    expectedVersion: order.version,
    status: 'reserved',
    rejectionReason: null,
    commands: [
      {
        type: 'CollectPayment',
        orderId: order.id,
        tenantId: order.tenantId,
        amountCents: orderAmountCents(order.lines),
        paymentOutcome: order.paymentOutcome,
      },
    ],
  }
}

export function onInventoryRejected(order: OrderSnapshot): SagaDecision {
  if (order.status !== 'placed') return { kind: 'ignore' }
  return reject(order, 'insufficient_stock')
}

export function onPaymentCaptured(order: OrderSnapshot): SagaDecision {
  if (order.status !== 'reserved') return { kind: 'ignore' }
  return {
    kind: 'transition',
    expectedVersion: order.version,
    status: 'allocated',
    rejectionReason: null,
    commands: [],
  }
}

export function onPaymentFailed(order: OrderSnapshot): SagaDecision {
  if (order.status !== 'reserved') return { kind: 'ignore' }
  return {
    kind: 'transition',
    expectedVersion: order.version,
    status: 'rejected',
    rejectionReason: 'payment_declined',
    commands: [release(order)],
  }
}

export function onReservationTimedOut(order: OrderSnapshot): SagaDecision {
  if (order.status !== 'placed') return { kind: 'ignore' }
  return reject(order, 'reservation_timeout')
}

function reject(order: OrderSnapshot, reason: RejectionReason): SagaDecision {
  return {
    kind: 'transition',
    expectedVersion: order.version,
    status: 'rejected',
    rejectionReason: reason,
    commands: [],
  }
}

function release(order: OrderSnapshot): SagaCommand {
  return {
    type: 'ReleaseReservation',
    orderId: order.id,
    tenantId: order.tenantId,
    lines: order.lines,
  }
}
