# ADR 0003: Transactional outbox and consumer inbox

## Status

Accepted

## Context

Publishing to RabbitMQ and committing an order cannot be one atomic action across two systems. A crash between them either loses the announcement or announces an order that never committed.

## Decision

`POST /v1/orders` inserts the order, its lines, the outbox row, and the idempotency row in one Postgres transaction. `published_at` stays null until a relay gets a broker confirm. The relay, added in phase 1, uses `FOR UPDATE SKIP LOCKED`. Consumers insert `(consumer, message_id)` into an inbox in the same transaction as their own write. A conflict means the delivery already happened: ack and stop.

The idempotency key is unique per tenant. The same key with the same normalized body returns the stored response. The same key with a different body is a 409. A unique violation on the key is retried once, so two concurrent identical requests leave one order.

## Consequences

Phase 0 proves the write side: the outbox row exists and `published_at` is null. Nothing is on the broker yet. Redelivery is safe only after the inbox exists, so phase 1 has to land before any consumer acks a message.
