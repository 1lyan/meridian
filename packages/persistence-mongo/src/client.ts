import type { MongoClientOptions } from 'mongodb'

/**
 * Testcontainers and a local mongod are a single host. directConnection skips
 * replica-set discovery, which that host does not answer.
 * Atlas uses mongodb+srv or several hosts, and discovery has to stay on.
 */
export function mongoClientOptions(url: string): MongoClientOptions {
  if (url.startsWith('mongodb+srv://') || url.includes(',')) return {}
  return { directConnection: true }
}
