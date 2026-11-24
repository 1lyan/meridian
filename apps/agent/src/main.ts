import { createJwksIdentity } from '@meridian/auth'
import { buildAgentApp } from './server.js'

const issuer = process.env.KEYCLOAK_ISSUER
const audience = process.env.KEYCLOAK_AUDIENCE
const apiUrl = process.env.API_URL
if (!issuer) throw new Error('KEYCLOAK_ISSUER is required')
if (!audience) throw new Error('KEYCLOAK_AUDIENCE is required')
if (!apiUrl) throw new Error('API_URL is required')

const app = buildAgentApp({
  identity: createJwksIdentity({ issuer, audience }),
  apiUrl,
  logger: true,
})

const port = Number(process.env.AGENT_PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'
await app.listen({ port, host })

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down')
  await app.close()
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').then(() => process.exit(0))
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM').then(() => process.exit(0))
})
