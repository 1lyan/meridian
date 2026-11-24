# Place order

`POST /v1/orders` is one Postgres transaction:

1. Lock the idempotency row for this tenant and key, if it exists.
2. When the stored hash matches, return the stored response and write nothing else.
3. When the hash differs, abort with `idempotency_conflict`.
4. Otherwise insert the order, its lines, the `OrderPlaced` outbox row, and the idempotency row.
5. Commit.

`published_at` is left null. Phase 1's relay publishes with confirms and then sets it. A crash before commit leaves no order and no outbox row. A crash after commit leaves both. The broker is not involved yet, so it cannot have a message the database does not know about.

Two requests with the same key can both observe an empty slot under read committed. The primary key on `(tenant_id, key)` lets one insert win. The loser sees unique violation `23505`, rolls back, and retries once. The retry takes the lock, sees the winner's hash, and returns that response. The test `lets one of two concurrent identical requests win` locks this in.

A second attempt that reuses an order id fails the order primary key after the new idempotency insert. That transaction rolls back, including the new key. The retry fails the same way and the error surfaces. The test `rolls the new idempotency key back` locks this in.

The tenant arrives as the `tenant_id` claim on a bearer token. The verifier parses it into a branded `TenantId` before the domain sees it. The same transaction sets the Postgres role and `app.tenant_id` so row-level security applies. `traceparent`, when the caller sends it, is stored on the outbox headers so the relay can put it on the AMQP message without reconstructing it.

Money is integer cents. Quantities are positive integers. Sku is trimmed, 1 to 64 characters, and unique inside the order. The database repeats those checks. The domain repeats them too, so a future caller that skips HTTP validation still cannot persist a broken order.
