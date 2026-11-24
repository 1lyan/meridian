import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { type CappedRequest, createCappedModel, type Model } from './model.js'

export function createBedrockModel(options: {
  modelId: string
  maxTokens: number
  region: string
}): Model {
  return createCappedModel({
    modelId: options.modelId,
    maxTokens: options.maxTokens,
    send: bedrockSender(options.region),
  })
}

function bedrockSender(
  region: string,
): (request: CappedRequest) => Promise<{ text: string; outputTokens: number }> {
  const client = new BedrockRuntimeClient({ region })
  return async (request) => {
    const response = await client.send(
      new ConverseCommand({
        modelId: request.modelId,
        messages: [{ role: 'user', content: [{ text: request.text }] }],
        inferenceConfig: { maxTokens: request.maxTokens },
      }),
    )
    const blocks = response.output?.message?.content ?? []
    const text = blocks
      .map((block) => ('text' in block ? block.text : ''))
      .join('')
    return { text, outputTokens: response.usage?.outputTokens ?? 0 }
  }
}
