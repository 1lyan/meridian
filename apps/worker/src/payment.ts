export type PaymentCapture = {
  orderId: string
  amountCents: number
  outcome: 'capture' | 'decline'
}

export type PaymentPort = {
  capture(input: PaymentCapture): Promise<'captured' | 'declined'>
}

/** Deterministic stand-in for Stripe. The order asks to capture or decline. */
export function scriptedPayment(): PaymentPort {
  return {
    async capture(input) {
      return input.outcome === 'decline' ? 'declined' : 'captured'
    },
  }
}
