import { migrate } from '@meridian/persistence-pg'
import { Pool } from 'pg'
import { startWorker } from './runtime.js'

const databaseUrl = process.env.DATABASE_URL
const rabbitUrl = process.env.RABBIT_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
if (!rabbitUrl) throw new Error('RABBIT_URL is required')

const pool = new Pool({ connectionString: databaseUrl })
await migrate(pool)
const timeout = Number(process.env.RESERVATION_TIMEOUT_MS ?? 15_000)
const worker = await startWorker({
  pool,
  rabbitUrl,
  reservationTimeoutMs: timeout,
})

async function shutdown(signal: string) {
  console.log({ signal }, 'worker shutting down')
  await worker.stop()
  await pool.end()
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').then(() => process.exit(0))
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM').then(() => process.exit(0))
})
