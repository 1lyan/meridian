import { randomUUID } from 'node:crypto'
import {
  catalogSearchQuery,
  placeOrderBody,
  receiveStockBody,
  upsertCatalogBody,
} from '@meridian/contracts'
import { catalogSearchText, embedText } from '@meridian/domain-catalog'
import {
  DomainError,
  InvalidTenantIdError,
  parseTenantId,
} from '@meridian/kernel'
import type { Projections } from '@meridian/persistence-mongo'
import {
  createDatabase,
  IdempotencyConflictError,
  listCatalogProducts,
  listOrderTimelines,
  loadOrder,
  receiveStock,
  searchCatalog,
  upsertCatalogProduct,
} from '@meridian/persistence-pg'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { placeOrder } from './place-order.js'

export type BuildAppOptions = {
  pool: Pool
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
    if (error instanceof DomainError) {
      return reply
        .code(422)
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
    const tenant = readTenant(request.headers['x-tenant-id'])
    if ('error' in tenant) return reply.code(400).send({ error: tenant.error })

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
      tenantId: tenant.tenantId,
      body: parsed.data,
      idempotencyKey,
      now: now(),
      requestId: request.id,
      ...(typeof traceparent === 'string' ? { traceparent } : {}),
    })

    if (result.replayed) reply.header('idempotent-replay', 'true')
    return reply.code(result.responseStatus).send(result.responseBody)
  })

  app.get('/v1/orders/:orderId', async (request, reply) => {
    const tenant = readTenant(request.headers['x-tenant-id'])
    if ('error' in tenant) return reply.code(400).send({ error: tenant.error })
    const params = request.params as { orderId: string }
    const order = await loadOrder(options.pool, tenant.tenantId, params.orderId)
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
    const tenant = readTenant(request.headers['x-tenant-id'])
    if ('error' in tenant) return reply.code(400).send({ error: tenant.error })
    const parsed = receiveStockBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_body', message: 'Request body is invalid' },
      })
    }
    await receiveStock(options.pool, {
      tenantId: tenant.tenantId,
      sku: parsed.data.sku,
      onHand: parsed.data.onHand,
      ...(parsed.data.warehouseId !== undefined
        ? { warehouseId: parsed.data.warehouseId }
        : {}),
    })
    return reply.code(204).send()
  })

  app.post('/v1/catalog', async (request, reply) => {
    const tenant = readTenant(request.headers['x-tenant-id'])
    if ('error' in tenant) return reply.code(400).send({ error: tenant.error })
    const parsed = upsertCatalogBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_body', message: 'Request body is invalid' },
      })
    }
    const saved = await upsertCatalogProduct(options.pool, {
      tenantId: tenant.tenantId,
      sku: parsed.data.sku,
      name: parsed.data.name,
      description: parsed.data.description,
      unitPriceCents: parsed.data.unitPriceCents,
      embedding: embedText(
        catalogSearchText(parsed.data.name, parsed.data.description),
      ),
    })
    return reply.code(200).send({
      productId: saved.id,
      tenantId: saved.tenantId,
      sku: saved.sku,
    })
  })

  app.get('/v1/catalog/search', async (request, reply) => {
    const tenant = readTenant(request.headers['x-tenant-id'])
    if ('error' in tenant) return reply.code(400).send({ error: tenant.error })
    const parsed = catalogSearchQuery.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_query', message: 'Query is invalid' },
      })
    }
    const results = await searchCatalog(options.pool, {
      tenantId: tenant.tenantId,
      query: parsed.data.q,
      embedding: embedText(parsed.data.q),
      limit: parsed.data.limit,
    })
    return { results }
  })

  app.get('/v1/catalog/:sku', async (request, reply) => {
    const tenant = readTenant(request.headers['x-tenant-id'])
    if ('error' in tenant) return reply.code(400).send({ error: tenant.error })
    const projections = requireProjections(options.projections, reply)
    if (!projections) return reply
    const params = request.params as { sku: string }
    const document = await projections.getCatalog(tenant.tenantId, params.sku)
    if (!document) {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'Catalog product not found' },
      })
    }
    return document
  })

  app.get('/v1/orders/:orderId/timeline', async (request, reply) => {
    const tenant = readTenant(request.headers['x-tenant-id'])
    if ('error' in tenant) return reply.code(400).send({ error: tenant.error })
    const projections = requireProjections(options.projections, reply)
    if (!projections) return reply
    const params = request.params as { orderId: string }
    const document = await projections.getTimeline(
      tenant.tenantId,
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
    const tenant = readTenant(request.headers['x-tenant-id'])
    if ('error' in tenant) return reply.code(400).send({ error: tenant.error })
    const projections = requireProjections(options.projections, reply)
    if (!projections) return reply
    const products = await listCatalogProducts(options.pool, tenant.tenantId)
    const timelines = await listOrderTimelines(options.pool, tenant.tenantId)
    const counts = await projections.replaceTenant(
      tenant.tenantId,
      products.map((product) => ({
        tenantId: product.tenantId,
        sku: product.sku,
        name: product.name,
        description: product.description,
        unitPriceCents: product.unitPriceCents,
      })),
      timelines.map((timeline) => ({
        tenantId: tenant.tenantId,
        orderId: timeline.orderId,
        status: timeline.status,
        version: timeline.version,
        rejectionReason: timeline.rejectionReason,
        events: timeline.events,
      })),
    )
    return counts
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

function readTenant(
  header: string | string[] | undefined,
):
  | { tenantId: ReturnType<typeof parseTenantId> }
  | { error: { code: string; message: string } } {
  if (typeof header !== 'string') {
    return {
      error: {
        code: 'tenant_required',
        message: 'x-tenant-id header is required',
      },
    }
  }
  try {
    return { tenantId: parseTenantId(header) }
  } catch (error) {
    if (error instanceof InvalidTenantIdError) {
      return { error: { code: error.code, message: error.message } }
    }
    throw error
  }
}
