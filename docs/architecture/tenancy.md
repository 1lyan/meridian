# Tenancy

The API verifies a bearer token for issuer, audience, and `tenant_id`. Keycloak issues that token from the realm imported by Compose. Cognito will use the same `IdentityProvider` checks.

Request and consumer transactions then run:

```sql
SET LOCAL ROLE meridian_app;
SELECT set_config('app.tenant_id', '<tenant uuid>', true);
```

`meridian_app` is not a superuser and does not own the tables, so row-level security applies. A query with no tenant predicate still returns only that tenant's rows. The setting is local to the transaction, so a pooled connection cannot carry it to the next caller.

The outbox relay and the reservation sweeper stay on the table owner. They have to see every tenant. The owner in local Compose and in the Homebrew setup is a superuser, and a superuser bypasses row-level security even when it is forced.

Mongo and catalog search repeat the tenant predicate. They do not inherit the Postgres policy. `GET /v1/audit` lists who placed an order, received stock, upserted a product, or moved the saga, for the caller's tenant only.

`GET /v1/approvals` and `GET /v1/agent-runs/:id` use the same role and the same Mongo tenant predicate. A tenant cannot read another tenant's approval or agent run.
