import type { TenantId } from '@meridian/kernel'

/** Identity, price, and the search vector live in Postgres. The Mongo document is a projection. */
export type SkuRecord = {
  tenantId: TenantId
  sku: string
  unitPriceCents: number
}

export const catalogContext = 'catalog' as const

/**
 * Width of the catalog embedding. Migration 0003 stores `vector(32)`.
 * The vector is a hashed bag of words so search runs without a model.
 */
export const embeddingDimensions = 32

export function catalogSearchText(name: string, description: string): string {
  return `${name}\n${description}`
}

export function embedText(text: string): number[] {
  const vector = Array.from({ length: embeddingDimensions }, () => 0)
  for (const token of tokensOf(text)) {
    const hash = fnv1a(token)
    const index = hash % embeddingDimensions
    const current = vector[index]
    if (current === undefined) continue
    vector[index] = current + 1
  }
  return normalize(vector)
}

export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.min(left.length, right.length)
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}

function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) {
    return vector.map((_, index) => (index === 0 ? 1 : 0))
  }
  return vector.map((value) => value / norm)
}
