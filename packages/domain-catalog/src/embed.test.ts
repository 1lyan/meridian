import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  catalogSearchText,
  cosineSimilarity,
  embeddingDimensions,
  embedText,
} from './index.js'

describe('catalog embeddings', () => {
  it('keeps a unit vector of the migration width for any text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (text) => {
        const vector = embedText(text)
        expect(vector).toHaveLength(embeddingDimensions)
        const norm = Math.sqrt(
          vector.reduce((sum, value) => sum + value * value, 0),
        )
        expect(norm).toBeCloseTo(1, 6)
        expect(cosineSimilarity(vector, vector)).toBeCloseTo(1, 6)
      }),
    )
  })

  it('ranks a shared token above an unrelated description', () => {
    const query = embedText('nitrile exam gloves')
    const gloves = embedText(
      catalogSearchText('Nitrile exam gloves', 'Powder-free nitrile gloves'),
    )
    const paper = embedText(
      catalogSearchText('Copy paper', 'Letter size white ream'),
    )
    expect(cosineSimilarity(query, gloves)).toBeGreaterThan(
      cosineSimilarity(query, paper),
    )
  })
})
