# Repository map

```
apps/api          HTTP composition root. Phase 0 place-order route.
apps/worker       Outbox relay and consumers. Phase 1.
apps/agent        Untrusted tool loop. Phase 4.
apps/web          Order timeline and approval inbox. Phase 4.
packages/kernel   Branded ids and DomainError.
packages/domain-* Invariants. No framework, no driver.
packages/contracts
                  Zod schemas for the HTTP edge.
packages/persistence-pg
                  Drizzle queries and the SQL migrations that actually run.
packages/persistence-mongo
                  Projection names. Phase 2.
packages/messaging
                  Exchange, routing key, and queue names. Phase 1 opens the broker.
packages/auth     IdentityProvider port. Phase 3.
packages/observability
                  Logger used by workers. The API uses Fastify's logger.
packages/testkit  Postgres testcontainer shared by integration tests.
infra/compose     Local brokers and databases.
infra/terraform   Phase 5. Do not apply during phase 0.
```

`dependency-cruiser` rejects a domain import of an adapter or of Fastify, Drizzle, `pg`, Zod, or Pino.
