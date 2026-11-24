import { DomainError } from '@meridian/kernel'
import { type ProposalLine, proposalLines } from './approval.js'

export const readToolNames = [
  'searchCatalog',
  'availableToPromise',
  'quote',
  'getOrder',
] as const

export const proposalToolName = 'proposeApproval'

/** Tools that change stock or money. The agent runtime refuses these names. */
export const commitToolNames = [
  'placeOrder',
  'receiveStock',
  'upsertCatalog',
  'executeApproval',
  'decideApproval',
] as const

const readTools = new Set<string>(readToolNames)
const commitTools = new Set<string>(commitToolNames)

export type ScreenedCall =
  | { tool: 'searchCatalog'; query: string }
  | { tool: 'availableToPromise'; sku: string }
  | { tool: 'quote'; sku: string; quantity: number }
  | { tool: 'getOrder'; orderId: string }
  | { tool: 'proposeApproval'; lines: ProposalLine[] }

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function screenToolCall(input: {
  name: string
  arguments: Readonly<Record<string, unknown>>
  sessionTenantId: string
  observedSkus: ReadonlySet<string>
}): ScreenedCall {
  if (commitTools.has(input.name)) {
    throw new DomainError(
      'commit_tool',
      `${input.name} commits stock or money. The agent can only propose.`,
    )
  }
  if (input.name !== proposalToolName && !readTools.has(input.name)) {
    throw new DomainError('unknown_tool', `Unknown tool ${input.name}`)
  }

  const tenantId = input.arguments.tenantId
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new DomainError(
      'tenant_dropped',
      'The tool call did not include tenantId',
    )
  }
  if (tenantId !== input.sessionTenantId) {
    throw new DomainError(
      'tenant_mismatch',
      'The tool call tenant does not match the signed-in tenant',
    )
  }

  if (input.name === 'searchCatalog') {
    const query = input.arguments.query
    if (
      typeof query !== 'string' ||
      query.trim().length === 0 ||
      query.length > 200
    ) {
      throw new DomainError('invalid_tool_arguments', 'query is required')
    }
    return { tool: 'searchCatalog', query: query.trim() }
  }

  if (input.name === 'availableToPromise') {
    const sku = requiredSku(input.arguments.sku, input.observedSkus)
    return { tool: 'availableToPromise', sku }
  }

  if (input.name === 'quote') {
    const sku = requiredSku(input.arguments.sku, input.observedSkus)
    const quantity = input.arguments.quantity
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      throw new DomainError(
        'invalid_tool_arguments',
        'quantity must be a positive integer',
      )
    }
    return { tool: 'quote', sku, quantity }
  }

  if (input.name === 'getOrder') {
    const orderId = input.arguments.orderId
    if (typeof orderId !== 'string' || !uuidPattern.test(orderId)) {
      throw new DomainError('invalid_tool_arguments', 'orderId must be a UUID')
    }
    return { tool: 'getOrder', orderId }
  }

  const lines = proposalLines(input.arguments.lines)
  for (const line of lines) {
    if (!input.observedSkus.has(line.sku)) {
      throw new DomainError(
        'invented_sku',
        `${line.sku} was not returned by search in this run`,
      )
    }
  }
  return { tool: 'proposeApproval', lines }
}

function requiredSku(
  value: unknown,
  observedSkus: ReadonlySet<string>,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainError('invalid_tool_arguments', 'sku is required')
  }
  if (!observedSkus.has(value)) {
    throw new DomainError(
      'invented_sku',
      `${value} was not returned by search in this run`,
    )
  }
  return value
}

export function observeSearchSkus(result: unknown, into: Set<string>): void {
  if (typeof result !== 'object' || result === null) return
  const results = (result as { results?: unknown }).results
  if (!Array.isArray(results)) return
  for (const hit of results) {
    if (typeof hit !== 'object' || hit === null) continue
    const sku = (hit as { sku?: unknown }).sku
    if (typeof sku === 'string' && sku.length > 0) into.add(sku)
  }
}
