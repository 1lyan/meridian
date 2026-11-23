# Meridian

Multi-tenant clinical supply control plane. Placing an order commits the order and an outbox row together. A local worker publishes that row to RabbitMQ and runs the saga: reserve stock, capture or decline payment, and release the reservation when payment declines. Projections, identity, the agent, and AWS come later. The decisions are in [docs/adr](docs/adr). The saga is described in [docs/architecture/saga.md](docs/architecture/saga.md).

There is no patient data in this system.

Money is integer cents. `499` is $4.99. The tenant is the `x-tenant-id` header, and it must be a UUID. Phase 3 replaces that header with a JWT.

## Prerequisites

- Node.js 22 or newer. `.nvmrc` pins 22.
- pnpm 11.20.0. From the repo root, `corepack enable` then `corepack pnpm install` uses the version in `package.json`.
- Docker, with the daemon running. Compose and the integration tests both start containers.

## Deploy the local stack

From the repo root:

```bash
corepack enable
corepack pnpm install
pnpm compose:up
cp .env.example .env
```

`pnpm compose:up` runs `docker compose up -d --wait`. It starts:

| Service | Address | Credentials | Used now |
| --- | --- | --- | --- |
| Postgres 16 with pgvector | `localhost:5432` | `meridian` / `meridian`, database `meridian` | yes |
| RabbitMQ 4 | `localhost:5672`, management UI `http://localhost:15672` | `guest` / `guest` | yes |
| MongoDB 7 | `localhost:27017` | none | phase 2 |
| Redis 7 | `localhost:6379` | none | later |
| Mailpit | `http://localhost:8025` | none | later |
| Keycloak 26 | `http://localhost:8080` | `admin` / `admin` | phase 3 |

These containers have no named volumes. `pnpm compose:down` removes them and the data inside them. Bring the stack back with `pnpm compose:up`. The API and the worker both apply migrations on startup, so a fresh database does not need a separate migrate step before `pnpm dev`.

Apply the schema on its own with the environment loaded:

```bash
set -a
source .env
set +a
pnpm migrate
```

The API and the worker read `DATABASE_URL`, `RABBIT_URL`, `PORT`, and `RESERVATION_TIMEOUT_MS` from the process environment. Copying `.env` does not load it. Run `set -a && source .env && set +a` in every terminal that starts the API, the worker, or migrations.

`.env.example` is:

```bash
DATABASE_URL=postgres://meridian:meridian@localhost:5432/meridian
RABBIT_URL=amqp://guest:guest@localhost:5672
PORT=3000
LOG_LEVEL=info
RESERVATION_TIMEOUT_MS=15000
```

`RESERVATION_TIMEOUT_MS` is how long a `placed` order may wait for a reservation before the worker rejects it. The default is 15 seconds.

## Run it locally

Load the environment, then start the API and the worker in two terminals.

Terminal 1, the HTTP API on port 3000:

```bash
set -a && source .env && set +a
pnpm dev
```

Terminal 2, the outbox relay and the saga:

```bash
set -a && source .env && set +a
pnpm dev:worker
```

`GET /health` returns `{"status":"ok","postgres":"ok"}` when the API can reach Postgres.

The worker must be running for an order to move past `placed`. It polls the outbox about every 200ms, publishes with publisher confirms, and consumes the order queue. A healthy local order reaches `allocated` or `rejected` in well under a second.

Stop the API or the worker with Ctrl-C. Stop the containers with `pnpm compose:down`.

## Tests

Unit tests do not need Docker, Postgres, or the `.env` file:

```bash
pnpm test
```

That runs Vitest in `@meridian/kernel`, `@meridian/contracts`, `@meridian/domain-ordering`, `@meridian/domain-inventory`, `@meridian/domain-billing`, `@meridian/messaging`, `@meridian/observability`, and `@meridian/api`. Run one package with:

```bash
pnpm --filter @meridian/domain-ordering test
```

Integration tests start their own Postgres and RabbitMQ with Testcontainers. They do not use the Compose ports, so the local stack can stay up. Docker must be running:

```bash
pnpm test:integration
```

`@meridian/api` covers place-order, idempotency, and the HTTP errors. `@meridian/worker` covers the saga: allocation, payment decline, insufficient stock, a duplicate delivery, the dead-letter queue, the reservation timeout, and a failed broker publish.

The same checks GitHub Actions runs:

```bash
pnpm check
```

That is Biome, TypeScript, the dependency-cruiser rule, unit tests, and integration tests. `pnpm lint` is Biome alone.

## Manual scenarios

Load the environment and start Compose, the API, and the worker before the saga scenarios. The validation calls need only the API.

Use one tenant for the whole session:

```bash
export TENANT=6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b
```

`POST /v1/orders` always answers with the body stored at insert time: `status` is `placed` and `version` is `1`, including on an idempotent replay. Follow the saga with `GET /v1/orders/:orderId`. Stock receives add to on-hand and answer `204` with an empty body.

### Positive: stock, allocation, and a replay

Receive 10 units of `GLV-100`. The default warehouse is `00000000-0000-4000-8000-000000000001`.

```bash
curl -sS -D - -o /dev/null -X POST localhost:3000/v1/stock \
  -H 'content-type: application/json' \
  -H "x-tenant-id: $TENANT" \
  -d '{"sku":"GLV-100","onHand":10}'
```

Expect `HTTP/1.1 204 No Content`.

Place an order for 2 units at 499 cents. Omit `paymentOutcome` and the API stores `capture`.

```bash
curl -sS -D - -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H "x-tenant-id: $TENANT" \
  -H 'idempotency-key: manual-happy-1' \
  -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":2,"unitPriceCents":499}]}'
```

Expect `201` and a body like:

```json
{"orderId":"<uuid>","tenantId":"6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b","status":"placed","version":1}
```

Save the id and poll until the worker finishes:

```bash
export ORDER_ID=<orderId from the response>
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -sS "localhost:3000/v1/orders/$ORDER_ID" -H "x-tenant-id: $TENANT"
  echo
  sleep 0.3
done
```

Expect the last body to be `status` `allocated`, `version` `3`, and `rejectionReason` `null`. Version 1 is the insert, version 2 is `reserved`, version 3 is `allocated`.

Send the same request again, including the same idempotency key and the same body:

```bash
curl -sS -D - -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H "x-tenant-id: $TENANT" \
  -H 'idempotency-key: manual-happy-1' \
  -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":2,"unitPriceCents":499}]}'
```

Expect `201`, the same `orderId`, and the response header `idempotent-replay: true`. The stored body is still `placed` / `version` 1. The GET above stays `allocated`.

Inspect Postgres:

```bash
docker compose exec postgres psql -U meridian -d meridian -c \
  "select sku, on_hand, reserved from stock_items where tenant_id = '$TENANT';"
docker compose exec postgres psql -U meridian -d meridian -c \
  "select status, quantity from reservations where order_id = '$ORDER_ID';"
docker compose exec postgres psql -U meridian -d meridian -c \
  "select p.account, p.amount_cents
   from postings p
   join journal_entries j on j.id = p.journal_id
   where j.order_id = '$ORDER_ID'
   order by p.amount_cents desc;"
```

Expect on-hand `10`, reserved `2`, one reservation with status `held` and quantity `2`, and two postings that sum to zero: `accounts_receivable` `998` and `sales_revenue` `-998` (`2 * 499`).

The RabbitMQ management UI at `http://localhost:15672` shows the process queue draining. Unpublished outbox rows for this tenant should reach zero:

```bash
docker compose exec postgres psql -U meridian -d meridian -c \
  "select count(*) from outbox where tenant_id = '$TENANT' and published_at is null;"
```

### Negative: the API rejects the call

These return before any order is written.

Missing tenant:

```bash
curl -sS -D - -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H 'idempotency-key: manual-no-tenant' \
  -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":1,"unitPriceCents":499}]}'
```

Expect `400` and `"code":"tenant_required"`.

A tenant that is not a UUID:

```bash
curl -sS -D - -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: clinic-north' \
  -H 'idempotency-key: manual-bad-tenant' \
  -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":1,"unitPriceCents":499}]}'
```

Expect `400` and `"code":"invalid_tenant_id"`.

Missing idempotency key:

```bash
curl -sS -D - -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H "x-tenant-id: $TENANT" \
  -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":1,"unitPriceCents":499}]}'
```

Expect `400` and `"code":"idempotency_key_required"`.

A body the contract refuses. Currency is only `USD`, each sku appears once, quantity is a positive integer, and price is a non-negative integer:

```bash
curl -sS -D - -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H "x-tenant-id: $TENANT" \
  -H 'idempotency-key: manual-bad-body' \
  -d '{"currency":"EUR","lines":[{"sku":"GLV-100","quantity":1,"unitPriceCents":499},{"sku":"GLV-100","quantity":1,"unitPriceCents":499}]}'
```

Expect `400` and `"code":"invalid_body"`. `issues` lists the currency and the duplicate sku.

The same idempotency key with a different body:

```bash
curl -sS -D - -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H "x-tenant-id: $TENANT" \
  -H 'idempotency-key: manual-happy-1' \
  -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":1,"unitPriceCents":499}]}'
```

Expect `409` and `"code":"idempotency_conflict"`. The original order is unchanged.

An unknown order, and the same order read as another tenant, are both `404` with `"code":"not_found"`:

```bash
curl -sS -D - "localhost:3000/v1/orders/$ORDER_ID" \
  -H 'x-tenant-id: 11111111-1111-4111-8111-111111111111'
```

### Negative: the saga rejects the order

Still on the first tenant. On-hand is 10 and reserved is 2, so 8 units are free.

Ask for 9. That does not fit:

```bash
curl -sS -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H "x-tenant-id: $TENANT" \
  -H 'idempotency-key: manual-short-1' \
  -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":9,"unitPriceCents":499}]}'
```

Copy `orderId` into `SHORT_ID` and poll `GET /v1/orders/$SHORT_ID`. Expect `status` `rejected`, `version` `2`, and `rejectionReason` `insufficient_stock`. Reserved stock stays `2`. This order has no journal and no `held` reservation.

Place a smaller order and tell the payment port to decline. The port declines only when the request says so. Anything else captures.

```bash
curl -sS -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H "x-tenant-id: $TENANT" \
  -H 'idempotency-key: manual-decline-1' \
  -d '{"currency":"USD","paymentOutcome":"decline","lines":[{"sku":"GLV-100","quantity":3,"unitPriceCents":499}]}'
```

Poll that order. Expect `rejected`, `version` `3`, and `rejectionReason` `payment_declined`. The worker reserved 3 and then released them, so `stock_items.reserved` is back to `2`. The reservation row for this order is `released`. There is no journal.

Confirm both:

```bash
docker compose exec postgres psql -U meridian -d meridian -c \
  "select order_id, status, quantity from reservations where tenant_id = '$TENANT' order by status;"
docker compose exec postgres psql -U meridian -d meridian -c \
  "select reserved from stock_items where tenant_id = '$TENANT' and sku = 'GLV-100';"
```

### Negative: the worker is stopped, then a reservation times out

Stop the worker with Ctrl-C. Leave the API running. Place one more order that would otherwise allocate:

```bash
curl -sS -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H "x-tenant-id: $TENANT" \
  -H 'idempotency-key: manual-waiting-1' \
  -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":1,"unitPriceCents":499}]}'
```

`GET` stays `placed` / `version` 1 for as long as the worker is down. The outbox row exists and `published_at` is null. Start the worker again and the same order becomes `allocated`. Reserved stock becomes `3`.

For the timeout, stop the worker again and place a final order:

```bash
curl -sS -X POST localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -H "x-tenant-id: $TENANT" \
  -H 'idempotency-key: manual-timeout-1' \
  -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":1,"unitPriceCents":499}]}'
```

`GET` shows `placed`. Age the row past the 15 second deadline and delete its unpublished outbox row. The worker publishes that row and runs the sweeper on the same loop, so leaving the row in place lets the reserve win and the order allocates.

```bash
export TIMEOUT_ID=<orderId>
docker compose exec postgres psql -U meridian -d meridian -c \
  "update orders set created_at = now() - interval '5 minutes' where id = '$TIMEOUT_ID';
   delete from outbox where aggregate_id = '$TIMEOUT_ID' and published_at is null;"
```

Start `pnpm dev:worker` and poll `GET /v1/orders/$TIMEOUT_ID`. Expect `rejected`, `version` `2`, and `rejectionReason` `reservation_timeout`. Reserved stock stays `3`, because this order was never reserved. If a reservation arrives after that rejection, the worker emits `ReleaseReservation` instead of collecting payment. The integration test covers that compensation.

## Phases

0. Done. Order plus outbox, idempotency, CI.
1. Done locally. Relay, inbox, saga, compensation, dead letters.
2. Rebuildable Mongo projections and pgvector search.
3. Keycloak, tenant isolation, row-level security.
4. Agent, approval inbox, fixture evals.
5. Free-plan AWS. Apply only while you are using it, then destroy. See ADR 0008.
6. k6, Toxiproxy, backup and restore.
