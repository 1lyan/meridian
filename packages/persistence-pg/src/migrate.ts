import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'

const migrationsDir = dirname(
  fileURLToPath(new URL('./migrations/0001_orders.sql', import.meta.url)),
)

export async function migrate(pool: Pool): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const applied = await pool.query<{ id: string }>(
    'SELECT id FROM schema_migrations',
  )
  const appliedIds = new Set(applied.rows.map((row) => row.id))
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const ran: string[] = []

  for (const file of files) {
    if (appliedIds.has(file)) continue
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [
        file,
      ])
      await client.query('COMMIT')
      ran.push(file)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  return ran
}
