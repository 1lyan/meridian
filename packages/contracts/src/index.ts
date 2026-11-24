import { z } from 'zod'

export const orderLineBody = z
  .object({
    sku: z.string().trim().min(1).max(64),
    quantity: z.number().int().positive(),
    unitPriceCents: z.number().int().nonnegative(),
  })
  .strict()

export const paymentOutcome = z.enum(['capture', 'decline'])

export const placeOrderBody = z
  .object({
    currency: z.literal('USD'),
    paymentOutcome: paymentOutcome.default('capture'),
    lines: z
      .array(orderLineBody)
      .min(1)
      .max(100)
      .superRefine((lines, context) => {
        const seen = new Set<string>()
        for (const line of lines) {
          if (seen.has(line.sku)) {
            context.addIssue({
              code: 'custom',
              message: `Duplicate sku ${line.sku}`,
            })
          }
          seen.add(line.sku)
        }
      }),
  })
  .strict()

export type PlaceOrderBody = z.infer<typeof placeOrderBody>

export const placeOrderResponse = z
  .object({
    orderId: z.string().uuid(),
    tenantId: z.string().uuid(),
    status: z.literal('placed'),
    version: z.literal(1),
  })
  .strict()

export type PlaceOrderResponse = z.infer<typeof placeOrderResponse>

export const receiveStockBody = z
  .object({
    sku: z.string().trim().min(1).max(64),
    onHand: z.number().int().positive(),
    warehouseId: z.string().uuid().optional(),
  })
  .strict()

export type ReceiveStockBody = z.infer<typeof receiveStockBody>

export const upsertCatalogBody = z
  .object({
    sku: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000),
    unitPriceCents: z.number().int().nonnegative(),
  })
  .strict()

export type UpsertCatalogBody = z.infer<typeof upsertCatalogBody>

export const catalogSearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

export type CatalogSearchQuery = z.infer<typeof catalogSearchQuery>

const proposalLine = z
  .object({
    sku: z.string().trim().min(1).max(64),
    quantity: z.number().int().positive(),
  })
  .strict()

export const approvalBody = z
  .object({
    currency: z.literal('USD'),
    lines: z
      .array(proposalLine)
      .min(1)
      .max(100)
      .superRefine((lines, context) => {
        const seen = new Set<string>()
        for (const line of lines) {
          if (seen.has(line.sku)) {
            context.addIssue({
              code: 'custom',
              message: `Duplicate sku ${line.sku}`,
            })
          }
          seen.add(line.sku)
        }
      }),
  })
  .strict()

export type ApprovalBody = z.infer<typeof approvalBody>

export const approvalDecisionBody = z
  .object({
    decision: z.enum(['approve', 'reject']),
  })
  .strict()

export type ApprovalDecisionBody = z.infer<typeof approvalDecisionBody>

export const agentRunBody = z
  .object({
    promptVersion: z.string().trim().min(1).max(40),
    status: z.enum(['completed', 'blocked']),
    request: z.string().trim().min(1).max(2000),
    transcript: z.array(z.unknown()).max(40),
    blockedReason: z.string().trim().min(1).max(80).nullable(),
    approvalId: z.string().uuid().nullable(),
  })
  .strict()

export type AgentRunBody = z.infer<typeof agentRunBody>

export const quoteQuery = z.object({
  sku: z.string().trim().min(1).max(64),
  quantity: z.coerce.number().int().positive().max(10_000),
})

export type QuoteQuery = z.infer<typeof quoteQuery>

export const availabilityQuery = z.object({
  sku: z.string().trim().min(1).max(64),
})

export type AvailabilityQuery = z.infer<typeof availabilityQuery>
