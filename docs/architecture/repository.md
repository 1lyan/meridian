# Repository map

```
apps/api          HTTP composition root. Orders, catalog, search, and projection rebuild.
apps/worker       Outbox relay, saga, and projection consumer.
apps/agent        Untrusted tool loop. Phase 4.
apps/web          Order timeline and approval inbox. Phase 4.
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
infra/terraform   Phase 5. Do not apply during phase 0.
```

`dependency-cruiser` rejects a domain import of an adapter or of Fastify, Drizzle, `pg`, Zod, or Pino.
