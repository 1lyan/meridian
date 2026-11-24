import { createProjections } from '@meridian/persistence-mongo'
import { migrate } from '@meridian/persistence-pg'
import { MongoClient } from 'mongodb'
import { Pool } from 'pg'
import { projectMessage } from './project.js'
import { startWorker } from './runtime.js'

const databaseUrl = process.env.DATABASE_URL
const rabbitUrl = process.env.RABBIT_URL
const mongoUrl = process.env.MONGO_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
if (!rabbitUrl) throw new Error('RABBIT_URL is required')
if (!mongoUrl) throw new Error('MONGO_URL is required')

const pool = new Pool({ connectionString: databaseUrl })
const mongo = new MongoClient(mongoUrl, { directConnection: true })
await mongo.connect()
const projections = createProjections(mongo.db('meridian'))
await projections.ensureIndexes()
await migrate(pool)
const timeout = Number(process.env.RESERVATION_TIMEOUT_MS ?? 15_000)
const worker = await startWorker({
  pool,
  rabbitUrl,
  reservationTimeoutMs: timeout,
  project: (message) => projectMessage(pool, projections, message),
})

async function shutdown(signal: string) {
  console.log({ signal }, 'worker shutting down')
  await worker.stop()
  await pool.end()
  await mongo.close()
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').then(() => process.exit(0))
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM').then(() => process.exit(0))
})
