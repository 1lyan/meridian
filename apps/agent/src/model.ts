export type ModelMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'tool'; name: string; content: string }

export type ModelTurn =
  | { kind: 'final'; text: string }
  | { kind: 'tool'; name: string; arguments: Record<string, unknown> }

export type Model = {
  complete(input: { messages: readonly ModelMessage[] }): Promise<ModelTurn>
}

export const modelTokenCap = 256

export function assertModelTokenCap(maxTokens: number): void {
  if (
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > modelTokenCap
  ) {
    throw new Error(`Model token cap is ${modelTokenCap}`)
  }
}

export type CappedRequest = {
  modelId: string
  maxTokens: number
  text: string
}

/** Every real model call goes through this cap. Fixture models do not. */
export function createCappedModel(options: {
  modelId: string
  maxTokens: number
  send: (
    request: CappedRequest,
  ) => Promise<{ text: string; outputTokens: number }>
}): Model {
  assertModelTokenCap(options.maxTokens)
  return {
    async complete({ messages }) {
      const response = await options.send({
        modelId: options.modelId,
        maxTokens: options.maxTokens,
        text: messages.map((message) => message.content).join('\n'),
      })
      if (response.outputTokens > options.maxTokens) {
        throw new Error('Model exceeded the token cap')
      }
      return { kind: 'final', text: response.text }
    },
  }
}
