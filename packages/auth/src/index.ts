export type AuthenticatedActor = {
  tenantId: string
  subject: string
}

/**
 * Phase 3 implements this with Keycloak locally and Cognito in AWS.
 * Until then the API reads the tenant from the x-tenant-id header.
 */
export type IdentityProvider = {
  verify(bearerToken: string): Promise<AuthenticatedActor>
}

export const identityPhase = 3 as const
