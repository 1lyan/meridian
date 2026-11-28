# Test and debug by hand

Use this when you want to see a scenario succeed, and when you want to find which process stopped it. The request bodies and the expected JSON are the same ones in the README. This page adds the order to run them in, and where to look when the result is wrong.

There is no patient data. Money is integer cents.

## Before any scenario

In every terminal that starts the API, the worker, or `pnpm migrate`:

```bash
set -a && source .env && set +a
```

Copying `.env` does not load it. A process started without those variables talks to the wrong database, or refuses to start.

See which Postgres owns port 5432:

```bash
lsof -nP -iTCP:5432 -sTCP:LISTEN
```

On this machine Homebrew `postgresql@18` owns `127.0.0.1:5432`. Compose Postgres is a different server and is not the one `pnpm migrate` reaches. Use `psql "$DATABASE_URL"` for the queries below. Use `docker compose exec postgres psql -U meridian -d meridian` only when nothing else is listening on 5432 and Compose owns the database.

Start the brokers. Leave Postgres out of Compose while Homebrew owns 5432:

```bash
docker compose up -d rabbitmq mongo redis mailpit keycloak
pnpm migrate
```

Keycloak imports the realm only when its container is created. If Alice's password grant fails after a realm change, recreate it:

```bash
docker compose up -d --force-recreate keycloak
```

Four terminals:

```bash
pnpm dev          # API, port 3000
pnpm dev:worker   # relay, saga, projections
```

`curl -sS localhost:3000/health` returns `{"status":"ok","postgres":"ok"}` with no token. `503` and `postgres: unavailable` means the API cannot run `select 1`. Check `DATABASE_URL` and that the role `meridian` exists.

Tokens. Alice is tenant `6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b`. Bob is `11111111-1111-4111-8111-111111111111`.

```bash
export TENANT=6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b
export TOKEN
TOKEN=$(curl -s -X POST http://localhost:8080/realms/meridian/protocol/openid-connect/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'client_id=meridian-api' \
  -d 'grant_type=password' \
  -d 'username=alice' \
  -d 'password=alice' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).access_token))')
export BOB_TOKEN
BOB_TOKEN=$(curl -s -X POST http://localhost:8080/realms/meridian/protocol/openid-connect/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'client_id=meridian-api' \
  -d 'grant_type=password' \
  -d 'username=bob' \
  -d 'password=bob' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).access_token))')
```

`echo "$TOKEN"` should be three dot-separated parts. An empty value means Keycloak did not return `access_token`. Read the curl without the `node` parser and check that the issuer you configured is exactly `http://localhost:8080/realms/meridian`.

`POST /v1/orders` always answers with the body stored at insert time: `placed`, version `1`. Poll `GET /v1/orders/:id` for the saga. Stock receives answer `204` with an empty body.

## Where to look

Postgres, as the table owner. This session sees every tenant. That is not a tenancy bug. `meridian` is a superuser and bypasses row-level security.

```bash
psql "$DATABASE_URL"
```

```sql
SELECT id, status, version, rejection_reason, payment_outcome
FROM orders
WHERE tenant_id = '6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b'
ORDER BY created_at DESC
LIMIT 10;

SELECT type, published_at IS NOT NULL AS published
FROM outbox
WHERE aggregate_id = '<order id>'
ORDER BY created_at;

SELECT sku, on_hand, reserved
FROM stock_items
WHERE tenant_id = '6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b';

SELECT order_id, status, quantity
FROM reservations
WHERE tenant_id = '6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b';

SELECT p.account, p.amount_cents
FROM postings p
JOIN journal_entries j ON j.id = p.journal_id
WHERE j.order_id = '<order id>';
```

To see what the API sees, drop privileges inside a transaction and roll it back:

```sql
BEGIN;
SET LOCAL ROLE meridian_app;
SELECT set_config('app.tenant_id', '6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b', true);
SELECT count(*) FROM orders;
ROLLBACK;
```

Repeat with Bob's tenant id. Alice's count and Bob's count are different. If they are equal, the policy is not applied. Confirm the role change with `SELECT current_user;` inside the same transaction.

RabbitMQ management is `http://localhost:15672` (`guest` / `guest`). The process queue is `commerce.order.process`. Retries sit in `commerce.order.retry` until the TTL expires, then return to the process queue. Poison messages end in `commerce.order.dead-letter`. A growing process queue with a running worker means the handler is throwing. Read the worker terminal before you requeue anything.

Mongo, after the worker has consumed:

```bash
mongosh "$MONGO_URL"
```

```javascript
db.getCollectionNames()
db['catalog-content'].find({ tenantId: '6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b' })
db['order-timeline'].find({ tenantId: '6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b' })
```

An empty collection with a healthy `GET /v1/orders/:id` means the worker is not projecting, or `MONGO_URL` differs between the API and the worker. Search still works, because search reads Postgres.

API logs are the terminal running `pnpm dev`. Worker logs are the other terminal. A `SyntaxError` on the body `not-json` at attempt 3 is the poison-message integration test, not a local failure, and it appears only when that test is running.

## 1. Place, allocate, replay

Receive 10 of `GLV-100`, then place 2 units at 499 cents with idempotency key `manual-happy-1`. The curls are in the README under "Positive: stock, allocation, and a replay".

Expect `204` on the stock call and `201` on the order. Poll `GET` until `status` is `allocated`, `version` is `3`, and `rejectionReason` is null. Version 1 is the insert, version 2 is `reserved`, version 3 is `allocated`.

Send the same key and the same body again. Expect `201`, the same `orderId`, and the header `idempotent-replay: true`. The body is still `placed` / version `1`. The GET stays `allocated`.

Then:

- `stock_items`: on-hand `10`, reserved `2`.
- one reservation, status `held`, quantity `2`.
- two postings that sum to zero: `accounts_receivable` `998`, `sales_revenue` `-998`.
- `outbox` rows for that order all have `published_at` set.

If GET stays `placed`:

- The worker terminal is not running, or it was started without `source .env`.
- `published_at` is null and the worker is running: the broker publish is failing. Check `RABBIT_URL` and that port 5672 accepts connections.
- `published_at` is set and the status is still `placed`: the consumer is failing. Read the worker log. A message in `commerce.order.retry` is that failure waiting out 1s, 5s, or 15s.

If GET is `rejected` / `insufficient_stock`: on-hand minus reserved was below 2 before this order. Receive more stock, use a new idempotency key, and place again. The old key will replay the old `201` and will not place a second order.

## 2. The API rejects the call

These write nothing. Expect the codes in the README section "Negative: the API rejects the call".

| Call                                           | Result                                              |
| ---------------------------------------------- | --------------------------------------------------- |
| No `Authorization` header                      | `401` `unauthenticated`                             |
| `Bearer clinic-north`                          | `401` `unauthenticated`                             |
| No `Idempotency-Key`                           | `400` `idempotency_key_required`                    |
| Currency `EUR`, or the same sku twice          | `400` `invalid_body`, and `issues` names the fields |
| Key `manual-happy-1` with a different quantity | `409` `idempotency_conflict`                        |
| Alice's order id, Bob's token                  | `404` `not_found`                                   |

A `401` whose message is `Bearer token was rejected` covers a bad signature, the wrong issuer, and the wrong audience. The issuer must be exactly `http://localhost:8080/realms/meridian`, and the audience must be `meridian-api`. `Token is missing sub`, `Token is missing tenant_id`, and `Token tenant_id is not a UUID` are separate messages, and they only appear after the signature and issuer checks have passed.

Confirm the conflict did not change the first order: GET `manual-happy-1`'s id and it is still `allocated`.

Bob's `404` is isolation, not a missing row. Prove it with the `SET LOCAL ROLE meridian_app` query above. As `meridian`, both tenants' rows are visible. As `meridian_app` with Bob's tenant, Alice's order is absent.

## 3. Insufficient stock

On-hand is 10 and reserved is 2, so 8 units are free. Place 9 with a new key, `manual-short-1`. Poll GET.

Expect `rejected`, version `2`, `rejectionReason` `insufficient_stock`. Reserved stays `2`. That order has no `held` reservation and no journal.

If it allocates, stock was higher than this script assumed. Read `on_hand` and `reserved` before judging the saga. If it stays `placed`, use the worker checks in scenario 1.

## 4. Payment decline

Place 3 units with `"paymentOutcome":"decline"` and key `manual-decline-1`.

Expect `rejected`, version `3`, `rejectionReason` `payment_declined`. The worker reserved 3 and then released them, so `stock_items.reserved` is back to `2`. The reservation row for this order is `released`. There is no journal.

If the order is `allocated`, the body did not contain `paymentOutcome`. The default is `capture`. The stored column is `orders.payment_outcome`.

If reserved climbs and never comes back, `ReleaseReservation` did not commit. Look for a `payment.failed` or `inventory.release` outbox row with `published_at` null, then the worker log.

## 5. Worker stopped, then a reservation timeout

Stop the worker with Ctrl-C. Leave the API up. Place 1 unit with key `manual-waiting-1`.

GET stays `placed` / version `1`. The outbox row exists and `published_at` is null. Start the worker. The same order becomes `allocated`, and reserved becomes `3`.

Stop the worker again. Place another unit with key `manual-timeout-1`. Age that order and delete its unpublished outbox row. Leaving the row in place lets the reserve win, and the order allocates instead of timing out.

```sql
UPDATE orders
SET created_at = now() - interval '5 minutes'
WHERE id = '<timeout order id>';

DELETE FROM outbox
WHERE aggregate_id = '<timeout order id>'
  AND published_at IS NULL;
```

Start the worker. Expect `rejected`, version `2`, `rejectionReason` `reservation_timeout`. Reserved stays `3`, because this order was never reserved.

If it stays `placed`, the sweeper is not running or `RESERVATION_TIMEOUT_MS` was raised in that worker's environment. The worker and the API do not have to share a shell, and a forgotten `source .env` leaves the default at 15 seconds only when the variable is unset. Check the worker process, not the API process.

## 6. Catalog, timeline, rebuild

Upsert `GLV-100` (nitrile exam gloves, 499 cents) and `PAP-100` (copy paper, 899 cents). Search `q=nitrile gloves` with Alice's token.

The gloves row is first. Keyword hits outrank the vector. Bob's token returns `"results":[]`. A search with no `q` is `400` `invalid_query`.

`GET /v1/catalog/GLV-100` is `404` until the worker consumes `CatalogUpserted`, then `200`. Bob's GET stays `404`. Search can succeed before that GET does, because search reads `catalog_products` and the GET reads Mongo.

After the funded order is `allocated`:

```bash
curl -sS "localhost:3000/v1/orders/$ORDER_ID/timeline" \
  -H "authorization: Bearer $TOKEN"
```

`status` is `allocated`. `events` includes `OrderPlaced` and `PaymentCaptured`. Bob gets `404`. A timeline `404` for Alice, while GET of the order is `allocated`, means the projection has not been written. Check the worker and `db["order-timeline"]`.

`GET /v1/audit` with Alice's token lists `order.place`, `stock.receive`, and `catalog.upsert`. `actorId` is Keycloak's internal user id. Bob's list is empty.

Rebuild, which replaces only Alice's documents:

```bash
curl -sS -X POST localhost:3000/v1/projections/rebuild \
  -H "authorization: Bearer $TOKEN"
```

The body is `{ "catalog": <count>, "timelines": <count> }`. GET the product and the timeline again. Both come back. Bob's documents are still there. Confirm in `mongosh` with Bob's tenant id before and after Alice's rebuild.

`503` `projection_unavailable` means the API has no `MONGO_URL`. Both processes require it.

## 7. Load, a cut, and a dump

Stop the worker first if the orders should stay `placed`. Otherwise they reserve stock.

```bash
k6 run -e API_URL=http://127.0.0.1:3000 -e TOKEN="$TOKEN" load/place-order.js
```

Five users, 20 seconds. The run fails if more than 5% of requests fail. A spike of `401` is an expired token. A spike of `409` means two iterations reused an idempotency key. The script uses `k6-<vu>-<iter>`, so that should not happen inside one run.

The Toxiproxy drill is in [chaos-drill.md](runbooks/chaos-drill.md). Start with `pnpm compose:chaos`. Point `DATABASE_URL` at `127.0.0.1:15432` and restart the API before `./scripts/chaos-drill.sh`. Expect a non-`201` while the toxic is in, then `201` after it is removed. A `201` during the cut means the API is still on port `5432`. Put `DATABASE_URL` back afterwards.

```bash
./scripts/backup-postgres.sh
./scripts/restore-postgres.sh backups/<file>.dump
```

Restore overwrites the target database. Take a fresh dump first. `pnpm migrate` after a restore is safe, because `schema_migrations` is in the dump. The RDS path is in [backup-restore.md](runbooks/backup-restore.md). Do not restore a drill dump onto a live RDS instance.

## Symptom index

| What you see                                     | Look here                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `role "meridian" does not exist`                 | Homebrew owns 5432 and the role was never created. README, "Postgres on the host".                            |
| `permission denied to create extension "vector"` | `meridian` is not a superuser on that server.                                                                 |
| Health `503`                                     | API `DATABASE_URL`, or Postgres is down.                                                                      |
| Every route `401`                                | Token, issuer, audience. Health does not need a token, so use it to separate "API down" from "auth rejected". |
| `201` then GET stays `placed`                    | Worker process, `published_at`, RabbitMQ port 5672.                                                           |
| GET `rejected` and you expected `allocated`      | `rejection_reason`, then `on_hand - reserved`, then `payment_outcome`.                                        |
| Replay header missing                            | The key or the body differs from the first call, or this is the first call.                                   |
| Timeline or catalog GET `404`, search `200`      | Worker has not projected. Mongo is behind Postgres on purpose.                                                |
| Bob sees Alice's row in `psql`                   | You are connected as `meridian`. Use `SET LOCAL ROLE meridian_app`.                                           |
| Health `502` on the AWS address                  | Caddy is up and the API is not. Check `/meridian/api` in CloudWatch. RDS requires `sslmode=no-verify`.        |
