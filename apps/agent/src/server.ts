import {
  type AuthenticatedActor,
  type IdentityProvider,
  UnauthenticatedError,
} from '@meridian/auth'
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify'
import { createHttpGateway, type ToolGateway } from './gateway.js'
import { createGuidedModel } from './guided-model.js'
import type { Model } from './model.js'
import { type AgentRunResult, runAgent } from './run.js'

export type AgentRunRecord = {
  runId: string
}

export function buildAgentApp(options: {
  identity: IdentityProvider
  apiUrl: string
  modelFor?: (actor: AuthenticatedActor) => Model
  gatewayFor?: (actor: AuthenticatedActor, token: string) => ToolGateway
  persist?: (
    actor: AuthenticatedActor,
    token: string,
    run: AgentRunResult,
  ) => Promise<AgentRunRecord>
  logger?: boolean
}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false })
  const modelFor =
    options.modelFor ?? ((actor) => createGuidedModel(actor.tenantId))
  const gatewayFor =
    options.gatewayFor ??
    ((_actor, token) => createHttpGateway({ apiUrl: options.apiUrl, token }))
  const persist = options.persist ?? persistToApi(options.apiUrl)

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof UnauthenticatedError) {
      return reply
        .code(401)
        .send({ error: { code: error.code, message: error.message } })
    }
    request.log.error(error)
    return reply
      .code(500)
      .send({ error: { code: 'internal', message: 'Internal error' } })
  })

  app.get('/health', async () => ({ status: 'ok' }))

  app.post('/runs', async (request, reply) => {
    const token = await bearer(options.identity, request, reply)
    if (!token) return reply
    const body = request.body as { message?: unknown }
    if (typeof body?.message !== 'string' || body.message.trim().length === 0) {
      return reply.code(400).send({
        error: { code: 'invalid_body', message: 'message is required' },
      })
    }
    const actor = token.actor
    const run = await runAgent({
      tenantId: actor.tenantId,
      request: body.message.trim(),
      model: modelFor(actor),
      gateway: gatewayFor(actor, token.raw),
    })
    const saved = await persist(actor, token.raw, run)
    return { ...run, runId: saved.runId }
  })

  return app
}

function persistToApi(apiUrl: string) {
  return async (
    _actor: AuthenticatedActor,
    token: string,
    run: AgentRunResult,
  ): Promise<AgentRunRecord> => {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/agent-runs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        promptVersion: run.promptVersion,
        status: run.status,
        request: run.request,
        transcript: run.transcript,
        blockedReason: run.blockedReason,
        approvalId: run.approvalId,
      }),
    })
    if (!response.ok) {
      throw new Error(`API ${response.status} while recording the agent run`)
    }
    const body = (await response.json()) as { id: string }
    return { runId: body.id }
  }
}

async function bearer(
  identity: IdentityProvider,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ raw: string; actor: AuthenticatedActor } | undefined> {
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
  const raw = header.slice('Bearer '.length).trim()
  const actor = await identity.verify(raw)
  return { raw, actor }
}
