# ADR 0005: Pooled tenancy

## Status

Accepted

## Context

Every store Meridian uses has to enforce the tenant. Postgres row-level security does not apply to Mongo or to a search index. A schema per tenant would multiply migrations and connection pools for a learning system with two demo clinics.

## Decision

Pooled schema. `tenant_id` is a column on tenant-owned rows and a branded `TenantId` in the type system. Repository methods take that type. Phase 0 reads it from the `x-tenant-id` header. Phase 3 reads it from the JWT and sets `SET LOCAL app.tenant_id` so row-level security is a backstop inside Postgres. Every other adapter repeats the predicate. A test must show tenant A cannot read tenant B.

## Consequences

The header is an explicit temporary edge, not an auth scheme. Idempotency keys are already unique per tenant, and the phase 0 test covers that split.
