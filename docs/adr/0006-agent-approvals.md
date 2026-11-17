# ADR 0006: The agent proposes, the core commits

## Status

Accepted

## Context

An agent that can call the order API with a service credential will eventually place an order the user did not confirm, especially when catalog text contains instructions.

## Decision

The agent is a separate process and is treated as untrusted. Read tools may search, quote, and fetch. A write creates an Approval aggregate. A person approves it, and the commerce core performs the stock or money change. Pull-request evals use a scripted model and fail if the agent invents a SKU, drops the tenant, calls a commit tool, or obeys an instruction planted in a product description. The nightly job is the only caller of a real model.

## Consequences

Phase 4 builds this. Phase 0 does not expose a tool-shaped write on `POST /v1/orders`. That route is for the core and, later, for an approval executor.
