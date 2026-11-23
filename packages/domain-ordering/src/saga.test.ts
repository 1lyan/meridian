import { parseOrderId, parseTenantId } from '@meridian/kernel'
import { describe, expect, it } from 'vitest'
import {
  type OrderSnapshot,
  onInventoryRejected,
  onInventoryReserved,
  onPaymentCaptured,
  onPaymentFailed,
  onReservationTimedOut,
} from './saga.js'

const orderId = parseOrderId('11111111-1111-4111-8111-111111111111')
const tenantId = parseTenantId('6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b')

function order(status: OrderSnapshot['status']): OrderSnapshot {
  return {
    id: orderId,
    tenantId,
    status,
    version: status === 'placed' ? 1 : 2,
    lines: [{ sku: 'GLV-100', quantity: 2, unitPriceCents: 499 }],
    paymentOutcome: 'capture',
    rejectionReason: status === 'rejected' ? 'reservation_timeout' : null,
  }
}

describe('order saga', () => {
  it('collects payment after stock is reserved', () => {
    const decision = onInventoryReserved(order('placed'))
    expect(decision).toMatchObject({
      kind: 'transition',
      status: 'reserved',
      commands: [{ type: 'CollectPayment', amountCents: 998 }],
    })
  })

  it('releases stock when a reservation arrives after a timeout rejection', () => {
    const decision = onInventoryReserved(order('rejected'))
    expect(decision).toMatchObject({
      kind: 'transition',
      status: 'rejected',
      commands: [{ type: 'ReleaseReservation' }],
    })
  })

  it('rejects a placed order when stock is insufficient', () => {
    expect(onInventoryRejected(order('placed'))).toMatchObject({
      status: 'rejected',
      rejectionReason: 'insufficient_stock',
      commands: [],
    })
  })

  it('allocates a reserved order when payment is captured', () => {
    expect(onPaymentCaptured(order('reserved'))).toMatchObject({
      status: 'allocated',
      commands: [],
    })
  })

  it('rejects and releases when payment fails', () => {
    expect(onPaymentFailed(order('reserved'))).toMatchObject({
      status: 'rejected',
      rejectionReason: 'payment_declined',
      commands: [{ type: 'ReleaseReservation' }],
    })
  })

  it('times out only while the order is still placed', () => {
    expect(onReservationTimedOut(order('placed'))).toMatchObject({
      rejectionReason: 'reservation_timeout',
    })
    expect(onReservationTimedOut(order('reserved'))).toEqual({ kind: 'ignore' })
  })

  it('ignores a second reservation once the order has moved on', () => {
    expect(onInventoryReserved(order('allocated'))).toEqual({ kind: 'ignore' })
    expect(onPaymentCaptured(order('allocated'))).toEqual({ kind: 'ignore' })
  })
})
