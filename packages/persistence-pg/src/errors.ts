export class IdempotencyConflictError extends Error {
  readonly code = 'idempotency_conflict' as const

  constructor() {
    super('This Idempotency-Key was already used with a different request body')
    this.name = 'IdempotencyConflictError'
  }
}
