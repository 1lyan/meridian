# Presenting Meridian

Speaking notes for a technical interview. Walk them in this order. Each section is a decision, the mechanism, and the question that decision is there to answer. The short version is at the end.

Meridian is a multi-tenant control plane for clinical supply. Clinics order gloves and paper against contract prices. It has tenants, a catalog, stock, orders, a ledger, and approvals. It has no patient, prescription, or clinical record. Money is integer cents. `499` is $4.99.

## 1. One core, on purpose

I did not start with a service per aggregate. That would have taught deployment before the domain had a reason to split. I also did not put everything in one unstructured app. The fitness function is `dependency-cruiser`: domain packages cannot import Fastify, Drizzle, `pg`, `amqplib`, MongoDB, Zod, or Pino. The shared kernel holds branded ids and `DomainError` and imports nothing else.

What runs is one API, one worker, and one agent process. A module becomes its own service only when it has its own scale or failure profile. The agent already has that profile, so it is a separate process and is treated as untrusted. ADR 0001.

If asked why TypeScript packages and not network boundaries: a package boundary fails in CI in seconds. A network boundary fails in production, after I have invented a deploy topology I do not need yet.

## 2. Postgres is the record

Orders, stock, and money need constraints and one transaction that can include the outbox. Catalog pages, order timelines, and agent transcripts are documents. They can change shape, and they can be thrown away.

PostgreSQL is the system of record. MongoDB holds three collections, `catalog-content`, `order-timeline`, and `agent-run`. `POST /v1/projections/rebuild` deletes only the caller's tenant and recreates those documents from the tables. A screen that cannot survive that rebuild is a design bug.

Search does not read Mongo. `GET /v1/catalog/search` is a Postgres query: keyword hits sort first, then pgvector cosine similarity. The vector is a hashed bag of words, 32 dimensions, the same width as migration `0003`. A model can replace `embedText` later without a new collection.

Redis is in Compose and on the dev instance for a later rate-limit and lock cache. The application does not read it. Stock and money are not cached there. ADR 0002 and ADR 0010.

If asked why not OpenSearch: both OpenSearch Service and Serverless have a floor cost, and I have not measured a recall or an operational limit that Postgres cannot meet. The extension is created in the first migration so local, CI, and RDS stay on the same engine family.

## 3. The write is one transaction

`POST /v1/orders` does this in one Postgres transaction:

1. Lock the idempotency row for this tenant and key, if it exists.
2. Same key and same normalized body: return the stored response and write nothing else. The header is `idempotent-replay: true`.
3. Same key and a different body: `409` `idempotency_conflict`.
4. Otherwise insert the order, its lines, an `OrderPlaced` outbox row with `published_at` null, and the idempotency row.
5. Commit.

The HTTP response is always the body stored at insert time: `status` `placed`, `version` `1`, even after the saga has moved on. The caller follows the saga with `GET /v1/orders/:id`.

Two concurrent requests with the same key can both see an empty slot under read committed. The primary key on `(tenant_id, key)` lets one insert win. The loser gets unique violation `23505`, rolls back, and retries once. The retry takes the lock and returns the winner's response.

A crash before commit leaves no order and no outbox row. A crash after commit leaves both. The broker cannot have a message the database does not know about, because the API never talks to the broker. ADR 0003.

## 4. Outbox, then inbox

Publishing to RabbitMQ and committing an order cannot be one atomic action. The relay closes that gap. It locks unpublished outbox rows with `FOR UPDATE SKIP LOCKED`, publishes on a confirm channel, and only then sets `published_at`. If the publish throws, the transaction rolls back and the row stays unpublished. A second worker can run the same loop. `SKIP LOCKED` is what keeps them off the same row.

Consumers insert `(consumer, message_id)` into an inbox in the same transaction as their own write. A conflict means this delivery already happened: commit nothing else and ack. A crash after the business write and before the ack is safe, because the redelivery hits the inbox.

RabbitMQ is topic exchanges, quorum queues, publisher confirms, and the mandatory flag. Unroutable messages go to an alternate exchange. A handler that throws is republished with attempt 1, then 2. The delays are 1s, 5s, and 15s. The third failure is nacked onto the dead-letter queue. A stale delivery loses an aggregate version check and is acked. Per-aggregate order is not assumed across competing consumers.

I did not use a retained log. The saga needs at-least-once delivery and a place for poison messages. It does not need to replay the stream from offset zero. Amazon MQ would be the same client behind a price. On the free-plan account the broker runs on the instance. ADR 0007.

## 5. The saga is orchestrated

A process manager owns the order: `placed`, then `reserved`, then `allocated`, or `rejected`.

`OrderPlaced` reserves stock, or emits `InventoryRejected` when the quantity does not fit. The process manager moves the order to `reserved` and emits `CollectPayment`. The payment port captures or declines based on `paymentOutcome` on the order. Capture writes a balanced journal and emits `PaymentCaptured`. The order becomes `allocated` at version 3. Decline emits `PaymentFailed`, the order becomes `rejected` with `payment_declined`, and `ReleaseReservation` returns the stock. Insufficient stock is `rejected` at version 2 with `insufficient_stock`, and nothing was reserved.

A `placed` order older than `RESERVATION_TIMEOUT_MS` (15 seconds) becomes `rejected` with `reservation_timeout`. If `InventoryReserved` arrives after that, the process manager emits `ReleaseReservation` instead of collecting payment.

The journal is two postings that sum to zero: `accounts_receivable` for the amount, `sales_revenue` for the negative. Two units at 499 cents is `998` and `-998`. The payment port is a deterministic fake. It declines only when the request says `paymentOutcome: "decline"`. Anything else captures. There is no card network in this system.

Notifications and the Mongo projection are choreography. They have no compensation. The state machine grew in a new migration. The check constraint in `0001` was left as the phase-0 machine on purpose. ADR 0004.

If asked orchestration versus choreography: reservation and payment can each fail after the order exists, and those failures need a timeout and a compensation. A projection does not. I did not make every consumer a peer of the process manager.

## 6. The tenant is a claim, and Postgres enforces it

Pooled schema. `tenant_id` is a column and a branded `TenantId`. A schema per tenant would multiply migrations and pools for two demo clinics.

The API verifies a bearer token: issuer, audience, RS256, `sub`, and `tenant_id`. Keycloak issues it locally. Cognito issues it on AWS. Cognito access tokens often have `client_id` and no `aud`, so the audience check accepts either. A missing or invalid bearer is `401` `unauthenticated`. Health stays open.

Every request and every consumer transaction then runs:

```sql
SET LOCAL ROLE meridian_app;
SELECT set_config('app.tenant_id', '<tenant uuid>', true);
```

`meridian_app` is `NOLOGIN` and does not own the tables, so row-level security applies. The setting is local to the transaction. A pooled connection cannot carry it to the next caller. A query with no tenant predicate still returns only that tenant's rows.

The relay and the reservation sweeper do not set the tenant. They have to see every tenant. They run as the table owner. That owner is a superuser locally, and a superuser bypasses row-level security even when it is forced. That is intentional, and it is why a `psql` session as `meridian` is not a proof of isolation. The proof is `SET LOCAL ROLE meridian_app`, or Bob's token getting `404` for Alice's order.

Mongo and catalog search repeat the tenant predicate. They do not inherit the Postgres policy. Postings have no `tenant_id`. Their policy is an `EXISTS` against `journal_entries`, because Postgres does not re-apply row-level security inside a policy subquery.

`GET /v1/audit` lists who placed an order, received stock, upserted a product, or moved the saga, for the caller's tenant only. `actorId` is the token `sub`. Keycloak's `sub` is the internal user id, not the username. ADR 0005 and ADR 0009.

## 7. The agent proposes. The core commits

The agent can search the catalog, check available-to-promise, quote a price, and read an order. The only write it can request is an approval. A person approves that row. `POST /v1/approvals/:id/execute` places the order through the same transaction as `POST /v1/orders`, with idempotency key `approval:<id>` and `paymentOutcome` `capture`. The price comes from `catalog_products`, not from the model.

`runAgent` checks every tool call before the gateway runs:

- `placeOrder`, `receiveStock`, `upsertCatalog`, `executeApproval`, and `decideApproval` stop the run with `commit_tool`. That check happens before the tenant check.
- A missing tenant is `tenant_dropped`. A different tenant is `tenant_mismatch`. The gateway never receives a tenant argument. The API takes it from the bearer token.
- `proposeApproval` may name only skus that `searchCatalog` returned in the same run. Anything else is `invented_sku`.

The prompt file is `apps/agent/prompts/buyer.md`, version `buyer-1`, stored on every run. Pull-request tests use a scripted model, including one that obeys an instruction planted in a product description. Local `pnpm dev:agent` uses a guided model that proposes the first search hit and ignores description text. The nightly workflow is the only caller of Bedrock, and that call is capped at 256 output tokens. ADR 0006.

If asked why the agent is not allowed to call `POST /v1/orders` with a service credential: catalog text is untrusted input. A model that can commit will eventually commit something the user did not confirm.

## 8. AWS is a budget with an off switch

The Free plan closes when the credits hit zero or after six months. NAT gateways, an idle load balancer, Amazon MQ, ElastiCache, and OpenSearch spend that balance while nobody is learning.

Bootstrap stays up: the state bucket, the lock table, budget alerts at $20 and $50, and two GitHub OIDC roles. Only `main` on this repo can assume them. The apply role is denied NAT, ElastiCache, OpenSearch, MSK, and Amazon MQ. The nightly role can invoke Bedrock Nova Micro and nothing else.

The dev stack is applied only while it is in use. One VPC, two public subnets, an internet gateway, no NAT. Terraform refuses `enable_nat`. One `t4g.small` with an Elastic IP, Docker, and the same processes as local except Postgres and Keycloak. RDS Postgres 16 is `db.t4g.micro`, not publicly accessible, port 5432 only from the instance security group. Port 22 is closed. SSM Run Command deploys it. Cognito is the issuer. A pre-token Lambda copies `custom:tenant_id` onto `tenant_id`. MongoDB is an Atlas M0 cluster the operator creates and allowlists to the Elastic IP. Images are `linux/arm64` because the instance is Graviton.

While that stack exists it costs about a dollar a day. Destroy is the off switch. Stopping the instance is not: AWS starts a stopped database again after seven days, and an Elastic IP can still cost money. The X-Ray daemon runs. The API does not export spans yet. Logs are pino, and container logs go to CloudWatch. ADR 0008.

## 9. Failure is something I can run

k6 places orders for 20 seconds with a fresh idempotency key per iteration. The run fails if more than 5% of requests fail. Stock is not required for the `201`.

Toxiproxy sits in front of Postgres on port `15432`, because Homebrew already owns `5432`. The drill adds a timeout toxic, expects place-order to fail, removes the toxic, and expects `201`. A `201` during the cut means the API is still talking to port `5432`.

Backups are `pg_dump --format=custom`. Restore overwrites the target database. RDS keeps one day of automated backups and has no public address, so a logical dump leaves through SSM and is restored locally, not onto the live instance. The postmortem template is blameless and starts from the timeline.

## What I would not claim

- The payment port is not a payment processor.
- Redis is provisioned and unused.
- Mail is not sent. Mailpit is local only.
- Spans are not exported. `traceparent` is stored on the outbox so the relay can copy it later.
- The AWS account has not been applied from this repository. The Terraform is validated. Applying it spends credits.
- The embedding is a hashed bag of words, not a semantic model.

## A twenty-minute cut

1. The domain and the boundary rule. One minute.
2. The place-order transaction and the idempotency race. Three minutes.
3. Outbox, confirms, inbox, and the dead-letter ladder. Four minutes.
4. The saga, including decline and the reservation timeout. Four minutes.
5. Row-level security and why the owner bypasses it. Three minutes.
6. The agent policy, and why the nightly model call is the only real one. Three minutes.
7. The free-plan shape and why destroy is the off switch. Two minutes.

## Questions worth having an answer for

**Why not a transaction that also publishes?** Two systems cannot commit together. The outbox makes the crash window visible: either both rows exist, or neither does.

**Why `SKIP LOCKED`?** So a second relay makes progress on a different row instead of waiting on the first relay's lock.

**Why is the replay body still `placed`?** The stored response is the contract of that key. The saga is a later fact. `GET` is how you see it. Changing the stored body would make the replay lie about what the first request returned.

**How does tenant B get `404` instead of an empty list?** The order id is in the URL. The policy filters it out, and the handler maps a missing row to `not_found`. That also avoids confirming that the id exists.

**What if the model invents a sku?** The run stops with `invented_sku` before an approval is written. The price, if an approval is written, still comes from the catalog row.

**What breaks first on the `t4g.small`?** Memory. The compose limits sum to about 1.5 GB on a 2 GB instance. RabbitMQ is the heavy one. Postgres and Keycloak stay off that box for that reason.
