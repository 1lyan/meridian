import { randomUUID } from 'node:crypto'
import {
  type AuthenticatedActor,
  type IdentityProvider,
  UnauthenticatedError,
} from '@meridian/auth'
import {
  catalogSearchQuery,
  placeOrderBody,
  receiveStockBody,
  upsertCatalogBody,
} from '@meridian/contracts'
import { catalogSearchText, embedText } from '@meridian/domain-catalog'
import { DomainError } from '@meridian/kernel'
import type { Projections } from '@meridian/persistence-mongo'
import {
  createDatabase,
  IdempotencyConflictError,
  listAudit,
  listCatalogProducts,
  listOrderTimelines,
  loadOrder,
  receiveStock,
  searchCatalog,
  upsertCatalogProduct,
  withTenant,
} from '@meridian/persistence-pg'
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify'
import type { Pool } from 'pg'
import { registerBuyerRoutes } from './buyer.js'
import { placeOrder } from './place-order.js'

export type BuildAppOptions = {
  pool: Pool
  identity: IdentityProvider
  projections?: Projections
  logger?: boolean
  now?: () => Date
}

export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: (request) => {
      const header = request.headers['x-request-id']
      if (
        typeof header === 'string' &&
        header.length > 0 &&
        header.length <= 200
      )
        return header
      return randomUUID()
    },
  })

  const db = createDatabase(options.pool)
  const now = options.now ?? (() => new Date())

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof IdempotencyConflictError) {
      return reply
        .code(409)
        .send({ error: { code: error.code, message: error.message } })
    }
    if (error instanceof UnauthenticatedError) {
      return reply
        .code(401)
        .send({ error: { code: error.code, message: error.message } })
    }
    if (error instanceof DomainError) {
      const status =
        error.code === 'not_found'
          ? 404
          : error.code === 'invalid_transition'
            ? 409
            : 422
      return reply
        .code(status)
        .send({ error: { code: error.code, message: error.message } })
    }
    request.log.error(error)
    return reply
      .code(500)
      .send({ error: { code: 'internal', message: 'Internal error' } })
  })

  app.get('/health', async (_request, reply) => {
    try {
      await options.pool.query('select 1')
      return { status: 'ok', postgres: 'ok' }
    } catch {
      return reply
        .code(503)
        .send({ status: 'degraded', postgres: 'unavailable' })
    }
  })

  app.post('/v1/orders', async (request, reply) => {
    const caller = await authenticate(options.identity, request, reply)
    if (!caller) return reply

    const idempotencyKey = request.headers['idempotency-key']
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.trim().length === 0 ||
      idempotencyKey.length > 255
    ) {
      return reply.code(400).send({
        error: {
          code: 'idempotency_key_required',
          message: 'Idempotency-Key header is required',
        },
      })
    }

    const parsed = placeOrderBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'invalid_body',
          message: 'Request body is invalid',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      })
    }

    const traceparent = request.headers.traceparent
    const result = await placeOrder(db, {
      tenantId: caller.tenantId,
      body: parsed.data,
      idempotencyKey,
      now: now(),
      requestId: request.id,
      actorId: caller.subject,
      ...(typeof traceparent === 'string' ? { traceparent } : {}),
    })

    if (result.replayed) reply.header('idempotent-replay', 'true')
    return reply.code(result.responseStatus).send(result.responseBody)
  })

  app.get('/v1/orders/:orderId', async (request, reply) => {
    const caller = await authenticate(options.identity, request, reply)
    if (!caller) return reply
    const params = request.params as { orderId: string }
    const order = await withTenant(options.pool, caller.tenantId, (client) =>
      loadOrder(client, caller.tenantId, params.orderId),
    )
    if (!order) {
      return reply
        .code(404)
        .send({ error: { code: 'not_found', message: 'Order not found' } })
    }
    return {
      orderId: order.id,
      tenantId: order.tenantId,
      status: order.status,
      version: order.version,
      rejectionReason: order.rejectionReason,
    }
  })

  app.post('/v1/stock', async (request, reply) => {
    const caller = await authenticate(options.identity, request, reply)
    if (!caller) return reply
    const parsed = receiveStockBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_body', message: 'Request body is invalid' },
      })
    }
    await receiveStock(options.pool, {
      tenantId: caller.tenantId,
      sku: parsed.data.sku,
      onHand: parsed.data.onHand,
      ...(parsed.data.warehouseId !== undefined
        ? { warehouseId: parsed.data.warehouseId }
        : {}),
      actorId: caller.subject,
    })
    return reply.code(204).send()
  })

  app.post('/v1/catalog', async (request, reply) => {
    const caller = await authenticate(options.identity, request, reply)
    if (!caller) return reply
    const parsed = upsertCatalogBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_body', message: 'Request body is invalid' },
      })
    }
    const saved = await upsertCatalogProduct(options.pool, {
      tenantId: caller.tenantId,
      sku: parsed.data.sku,
      name: parsed.data.name,
      description: parsed.data.description,
      unitPriceCents: parsed.data.unitPriceCents,
      embedding: embedText(
        catalogSearchText(parsed.data.name, parsed.data.description),
      ),
      actorId: caller.subject,
    })
    return reply.code(200).send({
      productId: saved.id,
      tenantId: saved.tenantId,
      sku: saved.sku,
    })
  })

  app.get('/v1/catalog/search', async (request, reply) => {
    const caller = await authenticate(options.identity, request, reply)
    if (!caller) return reply
    const parsed = catalogSearchQuery.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_query', message: 'Query is invalid' },
      })
    }
    const results = await withTenant(options.pool, caller.tenantId, (client) =>
      searchCatalog(client, {
        tenantId: caller.tenantId,
        query: parsed.data.q,
        embedding: embedText(parsed.data.q),
        limit: parsed.data.limit,
      }),
    )
    return { results }
  })

  app.get('/v1/catalog/:sku', async (request, reply) => {
    const caller = await authenticate(options.identity, request, reply)
    if (!caller) return reply
    const projections = requireProjections(options.projections, reply)
    if (!projections) return reply
    const params = request.params as { sku: string }
    const document = await projections.getCatalog(caller.tenantId, params.sku)
    if (!document) {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'Catalog product not found' },
      })
    }
    return document
  })

  app.get('/v1/orders/:orderId/timeline', async (request, reply) => {
    const caller = await authenticate(options.identity, request, reply)
    if (!caller) return reply
    const projections = requireProjections(options.projections, reply)
    if (!projections) return reply
    const params = request.params as { orderId: string }
    const document = await projections.getTimeline(
      caller.tenantId,
      params.orderId,
    )
    if (!document) {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'Order timeline not found' },
      })
    }
    return document
  })

  app.post('/v1/projections/rebuild', async (request, reply) => {
    const caller = await authenticate(options.identity, request, reply)
    if (!caller) return reply
    const projections = requireProjections(options.projections, reply)
    if (!projections) return reply
    const { products, timelines } = await withTenant(
      options.pool,
      caller.tenantId,
      async (client) => ({
        products: await listCatalogProducts(client, caller.tenantId),
        timelines: await listOrderTimelines(client, caller.tenantId),
      }),
    )
    const counts = await projections.replaceTenant(
      caller.tenantId,
      products.map((product) => ({
        tenantId: product.tenantId,
        sku: product.sku,
        name: product.name,
        description: product.description,
        unitPriceCents: product.unitPriceCents,
      })),
      timelines.map((timeline) => ({
        tenantId: caller.tenantId,
        orderId: timeline.orderId,
        status: timeline.status,
        version: timeline.version,
        rejectionReason: timeline.rejectionReason,
        events: timeline.events,
      })),
    )
    return counts
  })

  registerBuyerRoutes(app, {
    pool: options.pool,
    authenticate: (request, reply) =>
      authenticate(options.identity, request, reply),
  })

  app.get('/v1/audit', async (request, reply) => {
    const caller = await authenticate(options.identity, request, reply)
    if (!caller) return reply
    const entries = await withTenant(options.pool, caller.tenantId, (client) =>
      listAudit(client, 50),
    )
    return { entries }
  })

  return app
}

function requireProjections(
  projections: Projections | undefined,
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
): Projections | undefined {
  if (projections) return projections
  reply.code(503).send({
    error: {
      code: 'projection_unavailable',
      message: 'MongoDB is not configured',
    },
  })
  return undefined
}

async function authenticate(
  identity: IdentityProvider,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedActor | undefined> {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    await reply.code(401).send({
      error: {
        code: 'unauthenticated',
        message: 'Authorization bearer token is required',
      },
    })
    return undefined
  }
  return identity.verify(header.slice('Bearer '.length).trim())
}
