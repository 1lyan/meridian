# ADR 0002: Postgres is the record, Mongo is a projection

## Status

Accepted

## Context

Orders, stock, and money need constraints and a transaction that can include the outbox. Catalog content and order timelines are documents that change shape and can be thrown away.

## Decision

PostgreSQL is the system of record. MongoDB stores rebuildable documents: catalog content and order timelines. A rebuild command, added in phase 2, must recreate those documents from Postgres. Redis holds rate limits, short locks, and the idempotency cache. It does not hold stock or money.

Drizzle is the typed query surface. The SQL migration is what actually runs, including checks Drizzle would hide.

## Consequences

Phase 0 creates the order tables and leaves Mongo empty. A screen that cannot survive a projection rebuild is a design bug, not a migration.
