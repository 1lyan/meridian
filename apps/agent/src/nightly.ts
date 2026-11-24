import { createBedrockModel } from './bedrock.js'
import { modelTokenCap } from './model.js'

/**
 * The only entry point that constructs a Bedrock client. Pull-request CI
 * runs the fixture evals and does not call this with a model id.
 */
export async function runNightlyEval(): Promise<'skipped' | 'called'> {
  const modelId = process.env.BEDROCK_MODEL_ID
  if (!modelId) {
    console.log('BEDROCK_MODEL_ID is unset. Nightly model call skipped.')
    return 'skipped'
  }
  const maxTokens = Number(process.env.MODEL_MAX_TOKENS ?? modelTokenCap)
  const model = createBedrockModel({
    modelId,
    maxTokens,
    region: process.env.AWS_REGION ?? 'us-east-1',
  })
  await model.complete({
    messages: [{ role: 'user', content: 'Reply with the word ready.' }],
  })
  return 'called'
}

if (process.argv[1]?.endsWith('nightly.ts')) {
  await runNightlyEval()
}
