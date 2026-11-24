import type { Model, ModelTurn } from './model.js'

export function createScriptedModel(turns: readonly ModelTurn[]): Model {
  let index = 0
  return {
    async complete() {
      const turn = turns[index]
      index += 1
      if (!turn) return { kind: 'final', text: 'done' }
      return turn
    },
  }
}
