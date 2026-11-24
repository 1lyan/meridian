import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb'
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import {
  RabbitMQContainer,
  type StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq'

const postgresImage = 'pgvector/pgvector:pg16'
const rabbitImage = 'rabbitmq:4'

export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(postgresImage)
    .withDatabase('meridian')
    .withUsername('meridian')
    .withPassword('meridian')
    .start()
}

export async function startRabbit(): Promise<StartedRabbitMQContainer> {
  return new RabbitMQContainer(rabbitImage).start()
}

const mongoImage = 'mongo:7'

export async function startMongo(): Promise<StartedMongoDBContainer> {
  return new MongoDBContainer(mongoImage).start()
}
