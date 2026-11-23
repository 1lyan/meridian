import { exchanges, routingKeyFor } from '@meridian/messaging'
import { type OutboxRow, publishPending } from '@meridian/persistence-pg'
import type { ConfirmChannel } from 'amqplib'
import type { Pool } from 'pg'

export async function relayOnce(
  pool: Pool,
  channel: ConfirmChannel,
): Promise<number> {
  return publishPending(pool, async (row) => {
    publishRow(channel, row)
    await channel.waitForConfirms()
  })
}

function publishRow(channel: ConfirmChannel, row: OutboxRow): void {
  const traceparent = row.headers.traceparent
  const accepted = channel.publish(
    exchanges.orders,
    routingKeyFor(row.type),
    Buffer.from(
      JSON.stringify({
        messageId: row.id,
        type: row.type,
        payload: row.payload,
        headers: row.headers,
      }),
    ),
    {
      persistent: true,
      mandatory: true,
      messageId: row.id,
      contentType: 'application/json',
      headers: {
        type: row.type,
        tenantId: row.tenantId,
        attempt: 0,
        ...(typeof traceparent === 'string' ? { traceparent } : {}),
      },
    },
  )
  if (!accepted) throw new Error('Broker write buffer is full')
}
