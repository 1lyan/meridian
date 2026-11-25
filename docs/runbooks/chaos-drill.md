# Toxiproxy drill

Toxiproxy sits in front of Postgres. The API is pointed at the proxy. The drill cuts that hop, checks that place-order fails, then removes the cut and checks that place-order works again.

The image comes from Compose. No host install.

```bash
docker compose --profile chaos up -d toxiproxy
curl -sS localhost:8474/version
```

The API port is `8474`. Postgres is published on `15432` and RabbitMQ on `15673`. The default upstream is `host.docker.internal:5432`, which is the Homebrew database on this machine. If Compose owns Postgres, run the drill with `POSTGRES_UPSTREAM=postgres:5432` and start the postgres service on the same Compose network.

Stop the API and point it at the proxy:

```bash
set -a && source .env && set +a
export DATABASE_URL=postgres://meridian:meridian@127.0.0.1:15432/meridian
pnpm dev
```

Then, with Alice's token:

```bash
export TOKEN=<alice access token>
./scripts/chaos-drill.sh
```

Expect `place-order while cut` to be `500` or `000`, then `place-order after heal` to be `201`. A `201` during the cut means the API is still using port `5432`.

Put `DATABASE_URL` back to port `5432` when the drill is over. `docker compose --profile chaos stop toxiproxy` leaves the other services running.

k6 is a separate tool. Install it and run it against the healthy API, not through a cut:

```bash
brew install k6
k6 version
k6 run -e API_URL=http://127.0.0.1:3000 -e TOKEN="$TOKEN" load/place-order.js
```

Five virtual users place orders for 20 seconds. Each iteration uses its own idempotency key. The run fails if more than 5% of requests fail. Stock is not required for the `201`. Stop the worker first if you do not want those orders to reserve inventory.
