import { createHash } from 'node:crypto'
import type { PlaceOrderBody } from '@meridian/contracts'

/** Hash of the normalized body. Key order comes from the Zod schema, so whitespace does not matter. */
export function hashRequestBody(body: PlaceOrderBody): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex')
}
