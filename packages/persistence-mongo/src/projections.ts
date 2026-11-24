import type { Db } from 'mongodb'
import { projectionNames } from './names.js'

const orderTimeline = projectionNames[0]
const catalogContent = projectionNames[1]
if (!orderTimeline || !catalogContent) {
  throw new Error('Order timeline and catalog projections are required')
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
  replaceTenant(
    tenantId: string,
    catalogs: readonly CatalogDocument[],
    timelines: readonly TimelineDocument[],
  ): Promise<{ catalog: number; timelines: number }>
}

export function createProjections(db: Db): Projections {
  const catalogs = db.collection<CatalogDocument>(catalogContent)
  const timelines = db.collection<TimelineDocument>(orderTimeline)

  return {
    async ensureIndexes() {
      await catalogs.createIndex({ tenantId: 1, sku: 1 }, { unique: true })
      await timelines.createIndex({ tenantId: 1, orderId: 1 }, { unique: true })
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
    async replaceTenant(tenantId, catalogsIn, timelinesIn) {
      await catalogs.deleteMany({ tenantId })
      await timelines.deleteMany({ tenantId })
      if (catalogsIn.length > 0) await catalogs.insertMany([...catalogsIn])
      if (timelinesIn.length > 0) await timelines.insertMany([...timelinesIn])
      return { catalog: catalogsIn.length, timelines: timelinesIn.length }
    },
  }
}
