# ADR 0010: pgvector before a search cluster

## Status

Accepted

## Context

Catalog search needs keywords and similarity. OpenSearch Service and OpenSearch Serverless both have a minimum cost that the free-tier account should not carry until the simpler index is the bottleneck.

## Decision

Postgres uses the `pgvector` image from the first migration, so the extension is available before any query needs it. Phase 2 adds the catalog similarity query there. A keyword-plus-vector index in Postgres is the search implementation until its recall or its operational profile is the measured limit.

## Consequences

`CREATE EXTENSION vector` runs in migration `0001`, even though phase 0 has no vector column. That keeps the local, CI, and RDS engines on the same image family.
