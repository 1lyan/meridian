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

export function createJwksIdentity(options: {
  issuer: string
  audience: string
  jwksUrl?: string
}): IdentityProvider {
  const jwksUrl =
    options.jwksUrl ??
    `${options.issuer.replace(/\/$/, '')}/protocol/openid-connect/certs`
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
          audience,
          algorithms: ['RS256'],
        })
        payload = verified.payload
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
  },
): Promise<string> {
  const claims: JWTPayload = {}
  if (!input.omitTenant) claims.tenant_id = input.tenantId
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(input.subject)
    .setIssuer(testIssuer)
    .setAudience(input.audience)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(key)
}
