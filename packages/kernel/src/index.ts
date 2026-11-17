export class DomainError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

declare const tenantIdBrand: unique symbol

/** A tenant id that has passed UUID validation. Repositories require this type. */
export type TenantId = string & { readonly [tenantIdBrand]: true }

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class InvalidTenantIdError extends DomainError {
  constructor(value: string) {
    super(
      'invalid_tenant_id',
      `Tenant id must be a UUID, received ${JSON.stringify(value)}`,
    )
  }
}

export function parseTenantId(value: string): TenantId {
  if (!uuidPattern.test(value)) throw new InvalidTenantIdError(value)
  return value as TenantId
}

declare const orderIdBrand: unique symbol

export type OrderId = string & { readonly [orderIdBrand]: true }

export function newOrderId(): OrderId {
  return crypto.randomUUID() as OrderId
}

export function parseOrderId(value: string): OrderId {
  if (!uuidPattern.test(value)) {
    throw new DomainError(
      'invalid_order_id',
      `Order id must be a UUID, received ${JSON.stringify(value)}`,
    )
  }
  return value as OrderId
}
