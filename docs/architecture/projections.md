# Projections and catalog search

Postgres remains the record. Two Mongo collections are disposable views of it.

`catalog-content` is one document per tenant and sku. `POST /v1/catalog` upserts `catalog_products` and an outbox row in one transaction. The worker consumes `CatalogUpserted` and replaces the Mongo document. The embedding is not copied to Mongo.

`order-timeline` is one document per order. After each saga message commits, the worker appends that message id once and sets the status from the order row. A second delivery of the same message id does not add a second event.

`POST /v1/projections/rebuild` deletes that tenant's documents in those two collections and inserts what `catalog_products`, `orders`, and the order outbox say now. `agent-run` is left alone. A message already in flight can write again after the rebuild; the append is still idempotent on message id.

Search is `GET /v1/catalog/search`. It never reads Mongo. Keyword hits sort ahead of the rest, and pgvector cosine similarity breaks ties. The vector is a hashed bag of words, 32 dimensions, the same width as migration `0003`. A model can replace `embedText` later without a new collection.

Every read and the rebuild take the tenant from the bearer token. A tenant predicate is part of the Mongo filter because Mongo has no row-level security.
