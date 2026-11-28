import type { AuthenticatedActor } from '@meridian/auth'
import { availabilityQuery, quoteQuery } from '@meridian/contracts'
import {
  availableToPromise,
  quoteCatalogSku,
  withTenant,
} from '@meridian/persistence-pg'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'

export function registerBuyerRoutes(
  app: FastifyInstance,
  options: {
    pool: Pool
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<AuthenticatedActor | undefined>
  },
): void {
  const { pool, authenticate } = options

  app.get('/v1/availability', async (request, reply) => {
    const caller = await authenticate(request, reply)
    if (!caller) return reply
    const parsed = availabilityQuery.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_query', message: 'Query is invalid' },
      })
    }
    return withTenant(pool, caller.tenantId, (client) =>
      availableToPromise(client, caller.tenantId, parsed.data.sku),
    )
  })

  app.get('/v1/quotes', async (request, reply) => {
    const caller = await authenticate(request, reply)
    if (!caller) return reply
    const parsed = quoteQuery.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_query', message: 'Query is invalid' },
      })
    }
    const quote = await withTenant(pool, caller.tenantId, (client) =>
      quoteCatalogSku(
        client,
        caller.tenantId,
        parsed.data.sku,
        parsed.data.quantity,
      ),
    )
    if (!quote) {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'Catalog product not found' },
      })
    }
    return quote
  })
}
