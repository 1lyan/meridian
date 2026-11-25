// Cognito pre-token generation, V2. Copies the user attribute onto the
// token claim the API already checks for Keycloak.

exports.handler = async (event) => {
  const tenant = event.request?.userAttributes?.['custom:tenant_id']
  if (typeof tenant !== 'string' || tenant.length === 0) return event
  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: { tenant_id: tenant },
      },
      accessTokenGeneration: {
        claimsToAddOrOverride: { tenant_id: tenant },
      },
    },
  }
  return event
}
