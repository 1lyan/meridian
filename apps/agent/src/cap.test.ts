import { afterEach, describe, expect, it } from 'vitest'
import { createCappedModel, modelTokenCap } from './model.js'
import { runNightlyEval } from './nightly.js'

describe('model token cap', () => {
  const previous = process.env.BEDROCK_MODEL_ID

  afterEach(() => {
    if (previous === undefined) delete process.env.BEDROCK_MODEL_ID
    else process.env.BEDROCK_MODEL_ID = previous
  })

  it('refuses a request above the cap and skips Bedrock when no model is configured', async () => {
    expect(() =>
      createCappedModel({
        modelId: 'amazon.nova-micro-v1:0',
        maxTokens: modelTokenCap + 1,
        send: async () => ({ text: 'ready', outputTokens: 1 }),
      }),
    ).toThrow(/token cap/)

    let sent = 0
    const model = createCappedModel({
      modelId: 'amazon.nova-micro-v1:0',
      maxTokens: modelTokenCap,
      send: async (request) => {
        sent = request.maxTokens
        return { text: 'ready', outputTokens: request.maxTokens + 1 }
      },
    })
    await expect(
      model.complete({ messages: [{ role: 'user', content: 'ping' }] }),
    ).rejects.toThrow(/token cap/)
    expect(sent).toBe(modelTokenCap)

    delete process.env.BEDROCK_MODEL_ID
    await expect(runNightlyEval()).resolves.toBe('skipped')
  })
})
