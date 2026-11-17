import type { TenantId } from '@meridian/kernel'

export type MembershipRole = 'buyer' | 'approver' | 'admin'

export type Membership = {
  tenantId: TenantId
  subject: string
  role: MembershipRole
}

export const identityContext = 'identity' as const
