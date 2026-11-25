import http from 'k6/http'
import { check } from 'k6'

export const options = {
  vus: 5,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    checks: ['rate>0.95'],
  },
}

export function setup() {
  const api = required('API_URL')
  const token = required('TOKEN')
  const health = http.get(`${api}/health`)
  check(health, { 'health is ok': (response) => response.status === 200 })
  return { api, token }
}

export default function (data) {
  const response = http.post(
    `${data.api}/v1/orders`,
    JSON.stringify({
      currency: 'USD',
      lines: [{ sku: 'GLV-100', quantity: 1, unitPriceCents: 499 }],
    }),
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${data.token}`,
        'idempotency-key': `k6-${__VU}-${__ITER}`,
      },
    },
  )
  check(response, { 'order placed': (result) => result.status === 201 })
}

function required(name) {
  const value = __ENV[name]
  if (!value) throw new Error(`${name} is required`)
  return value.replace(/\/$/, '')
}
