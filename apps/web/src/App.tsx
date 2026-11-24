import { useState } from 'react'

type ApprovalLine = {
  sku: string
  quantity: number
  unitPriceCents: number
}

type Approval = {
  id: string
  status: string
  lines: ApprovalLine[]
  orderId: string | null
}

type Timeline = {
  orderId: string
  status: string
  events: { messageId: string; type: string }[]
}

const params = new URLSearchParams(window.location.search)

export function App() {
  const [apiBase, setApiBase] = useState(
    params.get('api') ??
      localStorage.getItem('meridian.api') ??
      'http://localhost:3000',
  )
  const [token, setToken] = useState(
    params.get('token') ?? localStorage.getItem('meridian.token') ?? '',
  )
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [orderId, setOrderId] = useState(params.get('order') ?? '')
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function remember() {
    localStorage.setItem('meridian.api', apiBase)
    localStorage.setItem('meridian.token', token)
  }

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBase.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token.trim()}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
    const text = await response.text()
    const body = text.length > 0 ? (JSON.parse(text) as unknown) : null
    if (!response.ok) {
      const message =
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof (body as { error?: { message?: string } }).error?.message ===
          'string'
          ? (body as { error: { message: string } }).error.message
          : `Request failed (${response.status})`
      throw new Error(message)
    }
    return body as T
  }

  async function loadInbox() {
    setBusy(true)
    setError(null)
    try {
      remember()
      const body = await call<{ approvals: Approval[] }>('/v1/approvals')
      setApprovals(body.approvals)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not load the inbox',
      )
    } finally {
      setBusy(false)
    }
  }

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusy(true)
    setError(null)
    try {
      await call(`/v1/approvals/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      })
      if (decision === 'approve') {
        const executed = await call<{ orderId: string }>(
          `/v1/approvals/${id}/execute`,
          { method: 'POST' },
        )
        setOrderId(executed.orderId)
      }
      await loadInbox()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not decide')
      setBusy(false)
    }
  }

  async function loadTimeline() {
    setBusy(true)
    setError(null)
    setTimeline(null)
    try {
      remember()
      const body = await call<Timeline>(`/v1/orders/${orderId}/timeline`)
      setTimeline(body)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not load the timeline',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <h1>Meridian</h1>
      <p className="lede">
        Approval inbox and order timeline. The agent proposes. Approving here
        places the order.
      </p>
      {error ? <p className="error">{error}</p> : null}

      <section>
        <label htmlFor="api">API</label>
        <input
          id="api"
          value={apiBase}
          onChange={(event) => setApiBase(event.target.value)}
        />
        <label htmlFor="token">Bearer token</label>
        <textarea
          id="token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </section>

      <section>
        <h2>Approvals</h2>
        <button type="button" onClick={() => void loadInbox()} disabled={busy}>
          Load inbox
        </button>
        {approvals.length === 0 ? (
          <p className="muted">No approvals loaded.</p>
        ) : (
          approvals.map((approval) => (
            <article className="card" key={approval.id}>
              <p>
                <strong>{approval.status}</strong> {approval.id}
              </p>
              {approval.lines.map((line) => (
                <p key={line.sku}>
                  {line.sku} × {line.quantity} · {money(line.unitPriceCents)}{' '}
                  each
                </p>
              ))}
              {approval.orderId ? <p>Order {approval.orderId}</p> : null}
              {approval.status === 'proposed' ? (
                <div className="row">
                  <button
                    type="button"
                    onClick={() => void decide(approval.id, 'approve')}
                    disabled={busy}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void decide(approval.id, 'reject')}
                    disabled={busy}
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </section>

      <section>
        <h2>Order timeline</h2>
        <label htmlFor="order">Order id</label>
        <input
          id="order"
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
        />
        <div className="row">
          <button
            type="button"
            onClick={() => void loadTimeline()}
            disabled={busy}
          >
            Load timeline
          </button>
        </div>
        {timeline ? (
          <article className="card">
            <p>
              {timeline.status} · {timeline.orderId}
            </p>
            {timeline.events.map((event) => (
              <p key={event.messageId}>{event.type}</p>
            ))}
          </article>
        ) : null}
      </section>
    </main>
  )
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
