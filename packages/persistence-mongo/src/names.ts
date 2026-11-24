/** Rebuildable documents. If a screen cannot be recreated from Postgres, it does not belong here. */
export const projectionNames = [
  'order-timeline',
  'catalog-content',
  'agent-run',
] as const

export type ProjectionName = (typeof projectionNames)[number]
