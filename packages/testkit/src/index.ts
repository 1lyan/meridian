import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'

const image = 'pgvector/pgvector:pg16'

export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(image)
    .withDatabase('meridian')
    .withUsername('meridian')
    .withPassword('meridian')
    .start()
}
