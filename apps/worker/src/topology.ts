import { exchanges, queues } from '@meridian/messaging'
import amqp, {
  type Channel,
  type ConfirmChannel,
  type ConsumeMessage,
} from 'amqplib'

export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(exchanges.unroutable, 'fanout', {
    durable: true,
  })
  await channel.assertExchange(exchanges.deadLetter, 'fanout', {
    durable: true,
  })
  await channel.assertExchange(exchanges.retry, 'topic', { durable: true })
  await channel.assertExchange(exchanges.orders, 'topic', {
    durable: true,
    arguments: { 'alternate-exchange': exchanges.unroutable },
  })

  const quorum = { durable: true, arguments: { 'x-queue-type': 'quorum' } }
  await channel.assertQueue(queues.unroutable, quorum)
  await channel.bindQueue(queues.unroutable, exchanges.unroutable, '')

  await channel.assertQueue(queues.orderDeadLetter, quorum)
  await channel.bindQueue(queues.orderDeadLetter, exchanges.deadLetter, '')

  await channel.assertQueue(queues.orderRetry, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': exchanges.orders,
    },
  })
  await channel.bindQueue(queues.orderRetry, exchanges.retry, '#')

  await channel.assertQueue(queues.orderProcess, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': exchanges.deadLetter,
    },
  })
  for (const pattern of ['order.*', 'inventory.*', 'billing.*', 'payment.*']) {
    await channel.bindQueue(queues.orderProcess, exchanges.orders, pattern)
  }
}

export async function connectBroker(rabbitUrl: string): Promise<{
  connection: Awaited<ReturnType<typeof amqp.connect>>
  publishChannel: ConfirmChannel
  consumeChannel: Channel
  close: () => Promise<void>
}> {
  const connection = await amqp.connect(rabbitUrl)
  const publishChannel = await connection.createConfirmChannel()
  const consumeChannel = await connection.createChannel()
  await assertTopology(publishChannel)
  await consumeChannel.prefetch(8)
  return {
    connection,
    publishChannel,
    consumeChannel,
    close: async () => {
      await publishChannel.close()
      await consumeChannel.close()
      await connection.close()
    },
  }
}

export function attemptOf(message: ConsumeMessage): number {
  const raw = message.properties.headers?.attempt
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : 0
}
