import type { Model, ModelMessage } from './model.js'

type SearchHit = {
  sku?: string
  unitPriceCents?: number
}

/**
 * Local stand-in for a model. It searches, checks availability, quotes, and
 * proposes the first catalog hit. It never reads instructions out of a description.
 */
export function createGuidedModel(tenantId: string): Model {
  return {
    async complete({ messages }) {
      const lastTool = [...messages]
        .reverse()
        .find((message) => message.role === 'tool')
      if (!lastTool) {
        const request = userText(messages)
        return {
          kind: 'tool',
          name: 'searchCatalog',
          arguments: { tenantId, query: request },
        }
      }
      if (lastTool.name === 'searchCatalog') {
        const hit = firstHit(lastTool.content)
        if (!hit?.sku) {
          return {
            kind: 'final',
            text: 'I found no catalog product for that request.',
          }
        }
        return {
          kind: 'tool',
          name: 'availableToPromise',
          arguments: { tenantId, sku: hit.sku },
        }
      }
      if (lastTool.name === 'availableToPromise') {
        const body = parseJson(lastTool.content)
        const available = body.available
        const sku = body.sku
        if (
          typeof sku !== 'string' ||
          typeof available !== 'number' ||
          available < 1
        ) {
          return { kind: 'final', text: 'That product is not available.' }
        }
        return {
          kind: 'tool',
          name: 'quote',
          arguments: { tenantId, sku, quantity: 1 },
        }
      }
      if (lastTool.name === 'quote') {
        const body = parseJson(lastTool.content)
        const sku = body.sku
        if (typeof sku !== 'string') {
          return { kind: 'final', text: 'I could not quote that product.' }
        }
        return {
          kind: 'tool',
          name: 'proposeApproval',
          arguments: { tenantId, lines: [{ sku, quantity: 1 }] },
        }
      }
      const body = parseJson(lastTool.content)
      const approvalId =
        typeof body.approvalId === 'string' ? body.approvalId : 'unknown'
      return {
        kind: 'final',
        text: `Proposed approval ${approvalId}. A person has to approve it before anything is ordered.`,
      }
    },
  }
}

function userText(messages: readonly ModelMessage[]): string {
  const user = messages.find((message) => message.role === 'user')
  return user?.content ?? ''
}

function firstHit(content: string): SearchHit | undefined {
  const body = parseJson(content)
  const results = body.results
  if (!Array.isArray(results)) return undefined
  const hit = results[0]
  if (typeof hit !== 'object' || hit === null) return undefined
  return hit as SearchHit
}

function parseJson(content: string): Record<string, unknown> {
  try {
    const value = JSON.parse(content) as unknown
    if (typeof value === 'object' && value !== null) {
      return value as Record<string, unknown>
    }
  } catch {
    return {}
  }
  return {}
}
