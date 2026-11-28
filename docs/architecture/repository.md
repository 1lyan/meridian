# Repository map

```
apps/api          HTTP composition root. Orders, catalog, search, and projection rebuild.
apps/worker       Outbox relay, saga, and projection consumer.
packages/kernel   Branded ids and DomainError.
packages/domain-* Invariants. No framework, no driver.
packages/contracts
                  Zod schemas for the HTTP edge.
packages/persistence-pg
                  Drizzle queries and the SQL migrations that actually run.
packages/persistence-mongo
                  Rebuildable catalog and order-timeline documents.
packages/messaging
                  Exchange, routing key, and queue names. Phase 1 opens the broker.
packages/auth     IdentityProvider. Keycloak JWKS locally, the same checks for Cognito later.
packages/observability
                  Logger used by workers. The API uses Fastify's logger.
packages/testkit  Postgres, RabbitMQ, and Mongo testcontainers.
infra/compose     Local brokers and databases.
infra/aws         Images and the compose file the EC2 instance runs.
infra/terraform   Bootstrap and the dev stack. Apply only from the runbook.
```

`dependency-cruiser` rejects a domain import of an adapter or of Fastify, Drizzle, `pg`, Zod, or Pino.
