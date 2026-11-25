#!/bin/sh
# Cuts Postgres through Toxiproxy, checks that place-order fails, then heals it.
# The API must be using postgres://meridian:meridian@127.0.0.1:15432/meridian.
set -eu

api="${API_URL:-http://127.0.0.1:3000}"
api="${api%/}"
proxy="${TOXIPROXY_URL:-http://127.0.0.1:8474}"
upstream="${POSTGRES_UPSTREAM:-host.docker.internal:5432}"
token="${TOKEN:?TOKEN is required}"

if ! curl -fsS "$proxy/version" >/dev/null; then
  echo "Toxiproxy is not on $proxy. Start it with: docker compose --profile chaos up -d toxiproxy"
  exit 1
fi

curl -fsS -X POST "$proxy/proxies" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"postgres\",\"listen\":\"0.0.0.0:15432\",\"upstream\":\"$upstream\"}" \
  >/dev/null 2>&1 || true
curl -fsS "$proxy/proxies/postgres" >/dev/null

curl -fsS -X DELETE "$proxy/proxies/postgres/toxics/down" >/dev/null 2>&1 || true

place() {
  curl -sS -o /tmp/meridian-chaos-body.txt -w '%{http_code}' \
    -X POST "$api/v1/orders" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer $token" \
    -H "idempotency-key: chaos-$(date +%s)-$1" \
    -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":1,"unitPriceCents":499}]}'
}

echo "cutting postgres"
curl -fsS -X POST "$proxy/proxies/postgres/toxics" \
  -H 'content-type: application/json' \
  -d '{"name":"down","type":"timeout","attributes":{"timeout":1}}' >/dev/null

cut_status="$(place cut)"
echo "place-order while cut: $cut_status"
if [ "$cut_status" = "201" ]; then
  echo "The API still placed an order. Point DATABASE_URL at 127.0.0.1:15432 and restart it."
  curl -fsS -X DELETE "$proxy/proxies/postgres/toxics/down" >/dev/null || true
  exit 1
fi

echo "healing postgres"
curl -fsS -X DELETE "$proxy/proxies/postgres/toxics/down" >/dev/null
healed="$(place healed)"
echo "place-order after heal: $healed"
if [ "$healed" != "201" ]; then
  echo "Expected 201 after the toxic was removed."
  cat /tmp/meridian-chaos-body.txt
  exit 1
fi

echo "drill passed"
