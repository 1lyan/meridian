import type { AuthenticatedActor } from '@meridian/auth'
import {
  agentRunBody,
  approvalBody,
  approvalDecisionBody,
  availabilityQuery,
  quoteQuery,
} from '@meridian/contracts'
import { proposalLines } from '@meridian/domain-approvals'
import { DomainError } from '@meridian/kernel'
import type { Projections } from '@meridian/persistence-mongo'
import {
  availableToPromise,
  type Database,
  decideApproval,
  listApprovals,
  loadAgentRun,
  loadApproval,
  markApprovalExecuted,
  proposeApproval,
  quoteCatalogSku,
  recordAgentRun,
  withTenant,
} from '@meridian/persistence-pg'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { placeOrder } from './place-order.js'

export function registerBuyerRoutes(
  app: FastifyInstance,
  options: {
    pool: Pool
    db: Database
    projections?: Projections
    now: () => Date
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<AuthenticatedActor | undefined>
  },
): void {
  const { pool, db, now, authenticate } = options

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

  app.post('/v1/approvals', async (request, reply) => {
    const caller = await authenticate(request, reply)
    if (!caller) return reply
    const parsed = approvalBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_body', message: 'Request body is invalid' },
      })
    }
    const saved = await proposeApproval(pool, {
      tenantId: caller.tenantId,
      lines: proposalLines(parsed.data.lines),
      actorId: caller.subject,
    })
    return reply.code(201).send(saved)
  })

  app.get('/v1/approvals', async (request, reply) => {
    const caller = await authenticate(request, reply)
    if (!caller) return reply
    const approvals = await withTenant(pool, caller.tenantId, (client) =>
      listApprovals(client, 50),
    )
    return { approvals }
  })

  app.get('/v1/approvals/:approvalId', async (request, reply) => {
    const caller = await authenticate(request, reply)
    if (!caller) return reply
    const params = request.params as { approvalId: string }
    const approval = await withTenant(pool, caller.tenantId, (client) =>
      loadApproval(client, params.approvalId),
    )
    if (!approval) {
      return reply
        .code(404)
        .send({ error: { code: 'not_found', message: 'Approval not found' } })
    }
    return approval
  })

  app.post('/v1/approvals/:approvalId/decision', async (request, reply) => {
    const caller = await authenticate(request, reply)
    if (!caller) return reply
    const parsed = approvalDecisionBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_body', message: 'Request body is invalid' },
      })
    }
    const params = request.params as { approvalId: string }
    const saved = await decideApproval(pool, {
      tenantId: caller.tenantId,
      approvalId: params.approvalId,
      decision: parsed.data.decision,
      actorId: caller.subject,
    })
    return saved
  })

  app.post('/v1/approvals/:approvalId/execute', async (request, reply) => {
    const caller = await authenticate(request, reply)
    if (!caller) return reply
    const params = request.params as { approvalId: string }
    const current = await withTenant(pool, caller.tenantId, (client) =>
      loadApproval(client, params.approvalId),
    )
    if (!current) {
      return reply
        .code(404)
        .send({ error: { code: 'not_found', message: 'Approval not found' } })
    }
    if (current.status === 'executed' && current.orderId) {
      return {
        approvalId: current.id,
        status: current.status,
        orderId: current.orderId,
      }
    }
    if (current.status !== 'approved') {
      throw new DomainError(
        'invalid_transition',
        `Cannot execute an approval in status ${current.status}`,
      )
    }
    const placed = await placeOrder(db, {
      tenantId: caller.tenantId,
      body: {
        currency: 'USD',
        paymentOutcome: 'capture',
        lines: current.lines.map((line) => ({
          sku: line.sku,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
        })),
      },
      idempotencyKey: `approval:${current.id}`,
      now: now(),
      requestId: request.id,
      actorId: caller.subject,
    })
    const saved = await markApprovalExecuted(pool, {
      tenantId: caller.tenantId,
      approvalId: current.id,
      orderId: placed.responseBody.orderId,
      actorId: caller.subject,
    })
    return {
      approvalId: saved.id,
      status: saved.status,
      orderId: saved.orderId,
    }
  })

  app.post('/v1/agent-runs', async (request, reply) => {
    const caller = await authenticate(request, reply)
    if (!caller) return reply
    const parsed = agentRunBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_body', message: 'Request body is invalid' },
      })
    }
    const saved = await recordAgentRun(pool, {
      tenantId: caller.tenantId,
      promptVersion: parsed.data.promptVersion,
      status: parsed.data.status,
      request: parsed.data.request,
      transcript: parsed.data.transcript,
      blockedReason: parsed.data.blockedReason,
      approvalId: parsed.data.approvalId,
    })
    if (options.projections) {
      await options.projections.upsertAgentRun({
        tenantId: saved.tenantId,
        runId: saved.id,
        promptVersion: saved.promptVersion,
        status: saved.status,
        request: saved.request,
        blockedReason: saved.blockedReason,
        approvalId: saved.approvalId,
        createdAt: saved.createdAt,
      })
    }
    return reply.code(201).send(saved)
  })

  app.get('/v1/agent-runs/:runId', async (request, reply) => {
    const caller = await authenticate(request, reply)
    if (!caller) return reply
    const params = request.params as { runId: string }
    const run = await withTenant(pool, caller.tenantId, (client) =>
      loadAgentRun(client, params.runId),
    )
    if (!run) {
      return reply
        .code(404)
        .send({ error: { code: 'not_found', message: 'Agent run not found' } })
    }
    return run
  })
}
