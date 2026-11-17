# ADR 0007: RabbitMQ delivery semantics

## Status

Accepted

## Context

The order saga needs at-least-once delivery, a place for poison messages, and a routing key that can be wrong without the message vanishing. It does not need a retained log.

## Decision

RabbitMQ, with topic exchanges per context, quorum queues, publisher confirms, and the mandatory flag. Unroutable messages go to an alternate exchange. A retry ladder ends in a dead-letter queue with a replay command. Consumers are idempotent via the inbox. Per-aggregate order is not assumed across competing consumers. A stale delivery loses an aggregate version check and is acked. `traceparent` is copied from the outbox headers onto the AMQP message.

Exchange and queue names live in `@meridian/messaging`.

## Consequences

Phase 0 stores `traceparent` on the outbox row and does not open a broker connection. Phase 1 adds the relay. Amazon MQ is a later, priced swap behind this same client. On the free-tier account the broker runs on the EC2 instance.
