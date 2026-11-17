# ADR 0001: Modular core, separate agent

## Status

Accepted

## Context

Meridian exists to practice boundaries, failure, and operability. A service per aggregate on day one would teach deployment topology before the domain has a reason to split. A single unstructured application would hide the boundaries the fitness functions are there to protect.

## Decision

One TypeScript commerce core, one worker process, and a separate agent service. Domain packages import no framework and no driver. `dependency-cruiser` fails the build when that rule breaks. A module becomes its own service only when it has its own scale or failure profile.

The shared kernel holds branded ids and `DomainError`. It imports nothing else.

## Consequences

Phase 0 runs the core as `apps/api`. The worker and agent packages exist so the names and the dependency rule are real before their behavior is. Local runtime is `tsx`. A compile-to-`dist` step waits until there is a production image to put it in.
