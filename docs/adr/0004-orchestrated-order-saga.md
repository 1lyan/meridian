# ADR 0004: Orchestrated order saga

## Status

Accepted

## Context

Reserving stock and capturing payment can each fail after the order has been placed. Those failures need a timeout and a compensation. Search projections and email do not.

## Decision

A process manager owns the order state machine: Placed, then Reserved, then Allocated, or Rejected. Inventory and billing emit facts. The process manager emits the compensating command `ReleaseReservation` when payment fails or the reservation times out. Notifications and the Mongo projection are choreography. They have no compensation.

Phase 0 persists only `placed`. Later statuses are a new migration. The check constraint in `0001_orders.sql` is the current state machine, on purpose.

## Consequences

The interesting failure tests (declined payment, duplicate `InventoryReserved`, reservation timeout) belong to phase 1. The state machine does not grow by editing the first migration.
