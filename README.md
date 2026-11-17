# Meridian

Multi-tenant clinical supply control plane. Phase 0 places an order and writes the outbox row in the same Postgres transaction. Stock, payment, projections, identity, the agent, and AWS come later. The decisions are in [docs/adr](docs/adr). The transaction is described in [docs/architecture/place-order.md](docs/architecture/place-order.md).

There is no patient data in this system.

## Run the API

```bash
pnpm install
pnpm compose:up
cp .env.example .env
pnpm migrate
pnpm dev
```

Postgres is the only dependency of this phase. Compose also starts MongoDB, RabbitMQ, Redis, Mailpit, and Keycloak so the later phases have a home.

```bash
curl -s -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: 6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b' \
  -H 'idempotency-key: demo-1' \
  -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":2,"unitPriceCents":499}]}'
```

Send the same request again and the response is the stored one, with `idempotent-replay: true`. Change the body and keep the key, and the API returns 409. `x-tenant-id` is a stand-in until phase 3 reads the tenant from a JWT.

## Checks

```bash
pnpm check
```

That runs Biome, the TypeScript project, the dependency rule, unit tests, and the Postgres integration tests. The integration tests start a `pgvector/pgvector:pg16` container.

## Phases

0. This slice. Order plus outbox, idempotency, CI.
1. Relay, inbox, saga, compensation, dead letters.
2. Rebuildable Mongo projections and pgvector search.
3. Keycloak, tenant isolation, row-level security.
4. Agent, approval inbox, fixture evals.
5. Free-plan AWS. Apply only while you are using it, then destroy. See ADR 0008.
6. k6, Toxiproxy, backup and restore.
