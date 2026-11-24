import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const promptVersion = 'buyer-1'

const promptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../prompts/buyer.md',
)

export const buyerPrompt = readFileSync(promptPath, 'utf8')

export function systemPrompt(tenantId: string): string {
  return `${buyerPrompt}\n\nThe tenant id for this run is ${tenantId}. Copy it into every tool call.`
}
