import { describe, expect, it } from 'vitest'
import { mongoClientOptions } from './client.js'

describe('mongoClientOptions', () => {
  it('uses a direct connection for one local host and discovery for Atlas', () => {
    expect(mongoClientOptions('mongodb://localhost:27017/meridian')).toEqual({
      directConnection: true,
    })
    expect(
      mongoClientOptions(
        'mongodb+srv://user:pass@cluster.example.net/meridian',
      ),
    ).toEqual({})
    expect(
      mongoClientOptions('mongodb://a.example:27017,b.example:27017/meridian'),
    ).toEqual({})
  })
})
