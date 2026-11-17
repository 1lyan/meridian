import { randomUUID } from 'node:crypto'
import { placeOrderBody } from '@meridian/contracts'
import {
  DomainError,
  InvalidTenantIdError,
  parseTenantId,
} from '@meridian/kernel'
import {
  createDatabase,
  IdempotencyConflictError,
} from '@meridian/persistence-pg'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { placeOrder } from './place-order.js'

export type BuildAppOptions = {
  pool: Pool
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

  return app
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
