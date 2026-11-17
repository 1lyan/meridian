import { z } from 'zod'

export const orderLineBody = z
  .object({
    sku: z.string().trim().min(1).max(64),
    quantity: z.number().int().positive(),
    unitPriceCents: z.number().int().nonnegative(),
  })
  .strict()

export const placeOrderBody = z
  .object({
    currency: z.literal('USD'),
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
