import {
  decideDisposition,
  exchanges,
  queues,
  retryTtlMs,
} from '@meridian/messaging'
import { createLogger } from '@meridian/observability'
import { rejectExpiredPlacedOrders } from '@meridian/persistence-pg'
import type { ConsumeMessage } from 'amqplib'
import type { Pool } from 'pg'
import { dispatch, parseIncoming } from './dispatch.js'
import { type PaymentPort, scriptedPayment } from './payment.js'
import { relayOnce } from './relay.js'
import { attemptOf, connectBroker } from './topology.js'

export type Worker = {
  stop: () => Promise<void>
  publish: (
    routingKey: string,
    body: Buffer,
    headers: Record<string, number | string>,
  ) => Promise<void>
}

export async function startWorker(options: {
  pool: Pool
  rabbitUrl: string
  reservationTimeoutMs?: number
  pollMs?: number
  payment?: PaymentPort
}): Promise<Worker> {
  const log = createLogger('worker')
  const timeoutMs = options.reservationTimeoutMs ?? 15_000
  const payment = options.payment ?? scriptedPayment()
  const broker = await connectBroker(options.rabbitUrl)
  let chain = Promise.resolve()
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work)
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const handle = async (message: ConsumeMessage) => {
    const attempt = attemptOf(message)
    try {
      await dispatch(options.pool, parseIncoming(message.content), payment)
      broker.consumeChannel.ack(message)
    } catch (error) {
      log.error({ err: error, attempt }, 'delivery failed')
      if (decideDisposition(attempt) === 'dead-letter') {
        broker.consumeChannel.nack(message, false, false)
        return
      }
      await exclusive(async () => {
        const accepted = broker.publishChannel.publish(
          exchanges.retry,
          message.fields.routingKey,
          message.content,
          {
            persistent: true,
            messageId: message.properties.messageId,
            contentType: 'application/json',
            expiration: String(retryTtlMs(attempt)),
            headers: {
              ...message.properties.headers,
              attempt: attempt + 1,
            },
          },
        )
        if (!accepted) throw new Error('Broker write buffer is full')
        await broker.publishChannel.waitForConfirms()
      })
      broker.consumeChannel.ack(message)
    }
  }

  await broker.consumeChannel.consume(queues.orderProcess, (message) => {
    if (message) void handle(message)
  })

  let ticking = false
  const tick = async () => {
    if (ticking) return
    ticking = true
    try {
      await exclusive(() => relayOnce(options.pool, broker.publishChannel))
      await rejectExpiredPlacedOrders(options.pool, new Date(), timeoutMs)
    } catch (error) {
      log.error({ err: error }, 'relay tick failed')
    } finally {
      ticking = false
    }
  }
  await tick()
  const timer = setInterval(() => {
    void tick()
  }, options.pollMs ?? 200)
  let stopped = false

  return {
    async stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      await broker.close()
    },
    async publish(routingKey, body, headers) {
      await exclusive(async () => {
        const accepted = broker.publishChannel.publish(
          exchanges.orders,
          routingKey,
          body,
          { persistent: true, headers },
        )
        if (!accepted) throw new Error('Broker write buffer is full')
        await broker.publishChannel.waitForConfirms()
      })
    },
  }
}
