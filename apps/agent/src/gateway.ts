import type { ProposalLine } from '@meridian/domain-approvals'

export type CatalogHit = {
  sku: string
  name: string
  description: string
  unitPriceCents: number
}

export type ToolGateway = {
  searchCatalog(query: string): Promise<{ results: CatalogHit[] }>
  availableToPromise(sku: string): Promise<{ sku: string; available: number }>
  quote(
    sku: string,
    quantity: number,
  ): Promise<{
    sku: string
    quantity: number
    unitPriceCents: number
    totalCents: number
  }>
  getOrder(orderId: string): Promise<{ orderId: string; status: string } | null>
  proposeApproval(
    lines: readonly ProposalLine[],
  ): Promise<{ approvalId: string }>
}

export function createHttpGateway(options: {
  apiUrl: string
  token: string
}): ToolGateway {
  const base = options.apiUrl.replace(/\/$/, '')
  const headers = { authorization: `Bearer ${options.token}` }

  return {
    async searchCatalog(query) {
      const url = new URL(`${base}/v1/catalog/search`)
      url.searchParams.set('q', query)
      return readJson(await fetch(url, { headers }))
    },
    async availableToPromise(sku) {
      const url = new URL(`${base}/v1/availability`)
      url.searchParams.set('sku', sku)
      return readJson(await fetch(url, { headers }))
    },
    async quote(sku, quantity) {
      const url = new URL(`${base}/v1/quotes`)
      url.searchParams.set('sku', sku)
      url.searchParams.set('quantity', String(quantity))
      return readJson(await fetch(url, { headers }))
    },
    async getOrder(orderId) {
      const response = await fetch(`${base}/v1/orders/${orderId}`, { headers })
      if (response.status === 404) return null
      return readJson(response)
    },
    async proposeApproval(lines) {
      const response = await fetch(`${base}/v1/approvals`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ currency: 'USD', lines }),
      })
      const body = await readJson<{ id: string }>(response)
      return { approvalId: body.id }
    },
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`API ${response.status} ${response.url}`)
  }
  return (await response.json()) as T
}
