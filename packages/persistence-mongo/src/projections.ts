import type { Db } from 'mongodb'
import { projectionNames } from './names.js'

const orderTimeline = projectionNames[0]
const catalogContent = projectionNames[1]
const agentRun = projectionNames[2]
if (!orderTimeline || !catalogContent || !agentRun) {
  throw new Error(
    'Order timeline, catalog, and agent-run projections are required',
  )
}

export type CatalogDocument = {
  tenantId: string
  sku: string
  name: string
  description: string
  unitPriceCents: number
}

export type TimelineEvent = {
  messageId: string
  type: string
  occurredAt: string
}

export type TimelineDocument = {
  tenantId: string
  orderId: string
  status: string
  version: number
  rejectionReason: string | null
  events: TimelineEvent[]
}

export type AgentRunDocument = {
  tenantId: string
  runId: string
  promptVersion: string
  status: string
  request: string
  blockedReason: string | null
  approvalId: string | null
  createdAt: string
}

export type Projections = {
  ensureIndexes(): Promise<void>
  upsertCatalog(document: CatalogDocument): Promise<void>
  appendOrderEvent(input: {
    tenantId: string
    orderId: string
    status: string
    version: number
    rejectionReason: string | null
    event: TimelineEvent
  }): Promise<void>
  getCatalog(tenantId: string, sku: string): Promise<CatalogDocument | null>
  getTimeline(
    tenantId: string,
    orderId: string,
  ): Promise<TimelineDocument | null>
  upsertAgentRun(document: AgentRunDocument): Promise<void>
  getAgentRun(tenantId: string, runId: string): Promise<AgentRunDocument | null>
  replaceTenant(
    tenantId: string,
    catalogs: readonly CatalogDocument[],
    timelines: readonly TimelineDocument[],
    agentRuns: readonly AgentRunDocument[],
  ): Promise<{ catalog: number; timelines: number; agentRuns: number }>
}

export function createProjections(db: Db): Projections {
  const catalogs = db.collection<CatalogDocument>(catalogContent)
  const timelines = db.collection<TimelineDocument>(orderTimeline)
  const runs = db.collection<AgentRunDocument>(agentRun)

  return {
    async ensureIndexes() {
      await catalogs.createIndex({ tenantId: 1, sku: 1 }, { unique: true })
      await timelines.createIndex({ tenantId: 1, orderId: 1 }, { unique: true })
      await runs.createIndex({ tenantId: 1, runId: 1 }, { unique: true })
    },
    async upsertCatalog(document) {
      await catalogs.replaceOne(
        { tenantId: document.tenantId, sku: document.sku },
        document,
        { upsert: true },
      )
    },
    async appendOrderEvent(input) {
      await timelines.updateOne(
        { tenantId: input.tenantId, orderId: input.orderId },
        {
          $set: {
            status: input.status,
            version: input.version,
            rejectionReason: input.rejectionReason,
          },
          $setOnInsert: {
            tenantId: input.tenantId,
            orderId: input.orderId,
            events: [],
          },
        },
        { upsert: true },
      )
      await timelines.updateOne(
        {
          tenantId: input.tenantId,
          orderId: input.orderId,
          events: {
            $not: { $elemMatch: { messageId: input.event.messageId } },
          },
        },
        { $push: { events: input.event } },
      )
    },
    async getCatalog(tenantId, sku) {
      const document = await catalogs.findOne(
        { tenantId, sku },
        { projection: { _id: 0 } },
      )
      if (!document) return null
      return {
        tenantId: document.tenantId,
        sku: document.sku,
        name: document.name,
        description: document.description,
        unitPriceCents: document.unitPriceCents,
      }
    },
    async getTimeline(tenantId, orderId) {
      const document = await timelines.findOne(
        { tenantId, orderId },
        { projection: { _id: 0 } },
      )
      if (!document) return null
      return {
        tenantId: document.tenantId,
        orderId: document.orderId,
        status: document.status,
        version: document.version,
        rejectionReason: document.rejectionReason,
        events: document.events,
      }
    },
    async upsertAgentRun(document) {
      await runs.replaceOne(
        { tenantId: document.tenantId, runId: document.runId },
        document,
        { upsert: true },
      )
    },
    async getAgentRun(tenantId, runId) {
      const document = await runs.findOne(
        { tenantId, runId },
        { projection: { _id: 0 } },
      )
      if (!document) return null
      return {
        tenantId: document.tenantId,
        runId: document.runId,
        promptVersion: document.promptVersion,
        status: document.status,
        request: document.request,
        blockedReason: document.blockedReason,
        approvalId: document.approvalId,
        createdAt: document.createdAt,
      }
    },
    async replaceTenant(tenantId, catalogsIn, timelinesIn, runsIn) {
      await catalogs.deleteMany({ tenantId })
      await timelines.deleteMany({ tenantId })
      await runs.deleteMany({ tenantId })
      if (catalogsIn.length > 0) await catalogs.insertMany([...catalogsIn])
      if (timelinesIn.length > 0) await timelines.insertMany([...timelinesIn])
      if (runsIn.length > 0) await runs.insertMany([...runsIn])
      return {
        catalog: catalogsIn.length,
        timelines: timelinesIn.length,
        agentRuns: runsIn.length,
      }
    },
  }
}
