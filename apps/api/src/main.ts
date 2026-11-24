import { createProjections } from '@meridian/persistence-mongo'
import { migrate } from '@meridian/persistence-pg'
import { MongoClient } from 'mongodb'
import { Pool } from 'pg'
import { buildApp } from './app.js'

const databaseUrl = process.env.DATABASE_URL
const mongoUrl = process.env.MONGO_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
if (!mongoUrl) throw new Error('MONGO_URL is required')

const pool = new Pool({ connectionString: databaseUrl })
const mongo = new MongoClient(mongoUrl, { directConnection: true })
await mongo.connect()
const projections = createProjections(mongo.db('meridian'))
await projections.ensureIndexes()
await migrate(pool)

const app = await buildApp({ pool, projections, logger: true })
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

await app.listen({ port, host })

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await pool.end()
  await mongo.close()
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').then(() => process.exit(0))
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM').then(() => process.exit(0))
})
