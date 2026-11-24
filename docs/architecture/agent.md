# Agent and approvals

The agent is its own process. It can search the catalog, check available-to-promise, quote a price, and read an order. The only write it can request is an approval. A person approves that row in the web inbox, and `POST /v1/approvals/:id/execute` places the order through the same transaction as `POST /v1/orders`.

The model is untrusted. `runAgent` checks every tool call before the gateway runs:

- `placeOrder`, `receiveStock`, `upsertCatalog`, `executeApproval`, and `decideApproval` stop the run with `commit_tool`.
- A missing `tenantId` stops it with `tenant_dropped`. A different tenant stops it with `tenant_mismatch`. The gateway never receives a tenant argument; the API takes the tenant from the bearer token.
- `proposeApproval` may name only skus that `searchCatalog` returned earlier in the same run. Anything else is `invented_sku`.
- The price on the approval comes from `catalog_products`, not from the model.

The prompt is `apps/agent/prompts/buyer.md`. Its version is `buyer-1`, and every agent run stores that version. Pull-request tests use a scripted model, including one that obeys an instruction planted in a product description. The nightly workflow is the only caller of Bedrock, and that call is capped at 256 output tokens. Locally, `pnpm dev:agent` uses a guided model that proposes the first search hit and does not read instructions out of a description.

Approvals and agent runs are Postgres tables under row-level security. Mongo `agent-run` is a projection. `POST /v1/projections/rebuild` recreates it for the caller's tenant.
