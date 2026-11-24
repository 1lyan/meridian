import {
  observeSearchSkus,
  type ScreenedCall,
  screenToolCall,
} from '@meridian/domain-approvals'
import { DomainError } from '@meridian/kernel'
import type { ToolGateway } from './gateway.js'
import type { Model, ModelMessage } from './model.js'
import { promptVersion, systemPrompt } from './prompt.js'

const stepLimit = 8

export type TranscriptEntry =
  | { kind: 'user'; text: string }
  | { kind: 'tool'; name: string; arguments: unknown; result: unknown }
  | { kind: 'blocked'; name: string; reason: string }
  | { kind: 'final'; text: string }

export type AgentRunResult = {
  promptVersion: string
  tenantId: string
  status: 'completed' | 'blocked'
  request: string
  blockedReason: string | null
  approvalId: string | null
  answer: string | null
  transcript: TranscriptEntry[]
}

export async function runAgent(input: {
  tenantId: string
  request: string
  model: Model
  gateway: ToolGateway
}): Promise<AgentRunResult> {
  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt(input.tenantId) },
    { role: 'user', content: input.request },
  ]
  const transcript: TranscriptEntry[] = [{ kind: 'user', text: input.request }]
  const observedSkus = new Set<string>()
  let approvalId: string | null = null

  for (let step = 0; step < stepLimit; step += 1) {
    const turn = await input.model.complete({ messages })
    if (turn.kind === 'final') {
      transcript.push({ kind: 'final', text: turn.text })
      return result(input, 'completed', null, approvalId, turn.text, transcript)
    }
    try {
      const call = screenToolCall({
        name: turn.name,
        arguments: turn.arguments,
        sessionTenantId: input.tenantId,
        observedSkus,
      })
      const toolResult = await dispatch(input.gateway, call)
      if (call.tool === 'searchCatalog')
        observeSearchSkus(toolResult, observedSkus)
      if (call.tool === 'proposeApproval') {
        const proposed = toolResult as { approvalId?: string }
        if (typeof proposed.approvalId === 'string')
          approvalId = proposed.approvalId
      }
      transcript.push({
        kind: 'tool',
        name: call.tool,
        arguments: turn.arguments,
        result: toolResult,
      })
      messages.push({
        role: 'tool',
        name: call.tool,
        content: JSON.stringify(toolResult),
      })
    } catch (error) {
      const reason = error instanceof DomainError ? error.code : 'tool_failed'
      transcript.push({ kind: 'blocked', name: turn.name, reason })
      return result(input, 'blocked', reason, approvalId, null, transcript)
    }
  }

  transcript.push({ kind: 'blocked', name: 'run', reason: 'step_limit' })
  return result(input, 'blocked', 'step_limit', approvalId, null, transcript)
}

async function dispatch(
  gateway: ToolGateway,
  call: ScreenedCall,
): Promise<unknown> {
  switch (call.tool) {
    case 'searchCatalog':
      return gateway.searchCatalog(call.query)
    case 'availableToPromise':
      return gateway.availableToPromise(call.sku)
    case 'quote':
      return gateway.quote(call.sku, call.quantity)
    case 'getOrder':
      return gateway.getOrder(call.orderId)
    case 'proposeApproval':
      return gateway.proposeApproval(call.lines)
  }
}

function result(
  input: { tenantId: string; request: string },
  status: AgentRunResult['status'],
  blockedReason: string | null,
  approvalId: string | null,
  answer: string | null,
  transcript: TranscriptEntry[],
): AgentRunResult {
  return {
    promptVersion,
    tenantId: input.tenantId,
    status,
    request: input.request,
    blockedReason,
    approvalId,
    answer,
    transcript,
  }
}
