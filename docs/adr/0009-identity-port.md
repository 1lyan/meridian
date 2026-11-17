# ADR 0009: One identity port, two issuers

## Status

Accepted

## Context

Local development needs an issuer we can run in Compose. The AWS account has Cognito and does not have IAM Identity Center on the Free plan.

## Decision

`IdentityProvider` is a port. Keycloak implements it in Compose. Cognito implements it in AWS. The API validates issuer, audience, and a `tenant_id` claim. Phase 0 does not validate a bearer token. The header `x-tenant-id` is the stand-in, and it is parsed into a `TenantId` or rejected.

## Consequences

Callers of the phase 0 API must send a UUID tenant. Replacing the header with a JWT should not change repository signatures, because those already take `TenantId`.
