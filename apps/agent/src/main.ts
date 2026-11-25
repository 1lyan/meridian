import { createJwksIdentity, identityConfigFromEnv } from '@meridian/auth'
import { buildAgentApp } from './server.js'

const apiUrl = process.env.API_URL
if (!apiUrl) throw new Error('API_URL is required')

const app = buildAgentApp({
  identity: createJwksIdentity(identityConfigFromEnv(process.env)),
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
