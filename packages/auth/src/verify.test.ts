import { describe, expect, it } from 'vitest'
import { createTestIdentity, UnauthenticatedError } from './index.js'

const tenantId = '6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b'

describe('bearer tokens', () => {
  it('returns the subject and the tenant id claim', async () => {
    const { identity, sign } = await createTestIdentity()
    const actor = await identity.verify(
      await sign({ tenantId, subject: 'alice' }),
    )
    expect(actor.subject).toBe('alice')
    expect(actor.tenantId).toBe(tenantId)
  })

  it('rejects a bad audience, a missing tenant, and a non-uuid tenant', async () => {
    const { identity, sign } = await createTestIdentity()
    await expect(
      identity.verify(await sign({ tenantId, audience: 'other-api' })),
    ).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(
      identity.verify(await sign({ tenantId, omitTenant: true })),
    ).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(
      identity.verify(await sign({ tenantId: 'clinic-north' })),
    ).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(identity.verify('not-a-token')).rejects.toBeInstanceOf(
      UnauthenticatedError,
    )
  })
})
