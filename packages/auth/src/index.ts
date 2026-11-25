import { parseTenantId, type TenantId } from '@meridian/kernel'
import {
  createRemoteJWKSet,
  generateKeyPair,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
  SignJWT,
} from 'jose'

export type AuthenticatedActor = {
  tenantId: TenantId
  subject: string
}

/**
 * Keycloak implements this in Compose. Cognito uses the same checks in AWS:
 * issuer, audience, and a tenant_id claim.
 */
export type IdentityProvider = {
  verify(token: string): Promise<AuthenticatedActor>
}

export class UnauthenticatedError extends Error {
  readonly code = 'unauthenticated' as const

  constructor(message: string) {
    super(message)
    this.name = 'UnauthenticatedError'
  }
}

export function defaultJwksUrl(issuer: string): string {
  const base = issuer.replace(/\/$/, '')
  if (base.includes('://cognito-idp.')) {
    return `${base}/.well-known/jwks.json`
  }
  return `${base}/protocol/openid-connect/certs`
}

/** Keycloak env names still work. AWS sets the IDENTITY_* names. */
export function identityConfigFromEnv(env: NodeJS.ProcessEnv): {
  issuer: string
  audience: string
  jwksUrl?: string
} {
  const issuer = env.IDENTITY_ISSUER ?? env.KEYCLOAK_ISSUER
  const audience = env.IDENTITY_AUDIENCE ?? env.KEYCLOAK_AUDIENCE
  const jwksUrl = env.IDENTITY_JWKS_URL ?? env.KEYCLOAK_JWKS_URL
  if (!issuer) throw new Error('IDENTITY_ISSUER or KEYCLOAK_ISSUER is required')
  if (!audience) {
    throw new Error('IDENTITY_AUDIENCE or KEYCLOAK_AUDIENCE is required')
  }
  return {
    issuer,
    audience,
    ...(jwksUrl !== undefined && jwksUrl.length > 0 ? { jwksUrl } : {}),
  }
}

export function createJwksIdentity(options: {
  issuer: string
  audience: string
  jwksUrl?: string
}): IdentityProvider {
  const jwksUrl = options.jwksUrl ?? defaultJwksUrl(options.issuer)
  return createIdentity(
    createRemoteJWKSet(new URL(jwksUrl)),
    options.issuer,
    options.audience,
  )
}

export const testIssuer = 'https://test.meridian.local/realms/meridian'
export const testAudience = 'meridian-api'

export async function createTestIdentity(): Promise<{
  identity: IdentityProvider
  sign: (input: {
    tenantId: string
    subject?: string
    audience?: string
    omitTenant?: boolean
    /** Cognito access tokens carry client_id and no aud. */
    useClientId?: boolean
  }) => Promise<string>
}> {
  const keys = await generateKeyPair('RS256')
  return {
    identity: createIdentity(keys.publicKey, testIssuer, testAudience),
    sign: (input) =>
      signToken(keys.privateKey, {
        tenantId: input.tenantId,
        subject: input.subject ?? 'tester',
        audience: input.audience ?? testAudience,
        omitTenant: input.omitTenant === true,
        useClientId: input.useClientId === true,
      }),
  }
}

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>

function createIdentity(
  key: JWTVerifyGetKey | KeyPair['publicKey'],
  issuer: string,
  audience: string,
): IdentityProvider {
  return {
    async verify(token) {
      if (token.trim().length === 0) {
        throw new UnauthenticatedError('Bearer token was rejected')
      }
      let payload: JWTPayload
      try {
        const verified = await jwtVerify(token, key, {
          issuer,
          algorithms: ['RS256'],
        })
        payload = verified.payload
        if (!audienceMatches(payload, audience)) {
          throw new UnauthenticatedError('Token audience was rejected')
        }
      } catch {
        throw new UnauthenticatedError('Bearer token was rejected')
      }
      const subject = payload.sub
      if (typeof subject !== 'string' || subject.length === 0) {
        throw new UnauthenticatedError('Token is missing sub')
      }
      const tenantClaim = tenantClaimOf(payload.tenant_id)
      if (tenantClaim === null) {
        throw new UnauthenticatedError('Token is missing tenant_id')
      }
      try {
        return { subject, tenantId: parseTenantId(tenantClaim) }
      } catch {
        throw new UnauthenticatedError('Token tenant_id is not a UUID')
      }
    },
  }
}

function audienceMatches(payload: JWTPayload, audience: string): boolean {
  const aud = payload.aud
  if (typeof aud === 'string') return aud === audience
  if (Array.isArray(aud)) return aud.includes(audience)
  const clientId = (payload as { client_id?: unknown }).client_id
  return clientId === audience
}

function tenantClaimOf(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (
    Array.isArray(value) &&
    value.length === 1 &&
    typeof value[0] === 'string'
  ) {
    return value[0]
  }
  return null
}

async function signToken(
  key: KeyPair['privateKey'],
  input: {
    tenantId: string
    subject: string
    audience: string
    omitTenant: boolean
    useClientId: boolean
  },
): Promise<string> {
  const claims: JWTPayload = {}
  if (!input.omitTenant) claims.tenant_id = input.tenantId
  if (input.useClientId) claims.client_id = input.audience
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(input.subject)
    .setIssuer(testIssuer)
    .setIssuedAt()
    .setExpirationTime('2h')
  if (!input.useClientId) jwt.setAudience(input.audience)
  return jwt.sign(key)
}
