#!/bin/sh
# Recreates the two demo tenants through the public API. Safe to run again.
# Alice's order is the deployed saga: it must reach allocated.
set -eu

: "${AWS_REGION:?}"
: "${USER_POOL_ID:?}"
: "${CLIENT_ID:?}"
: "${API_URL:?}"
: "${ALICE_PASSWORD:?}"
: "${BOB_PASSWORD:?}"

alice_tenant="6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b"
bob_tenant="11111111-1111-4111-8111-111111111111"

ensure_user() {
  username="$1"
  password="$2"
  tenant="$3"
  if aws cognito-idp admin-get-user --region "$AWS_REGION" --user-pool-id "$USER_POOL_ID" --username "$username" >/dev/null 2>&1; then
    echo "user $username already exists"
  else
    aws cognito-idp admin-create-user \
      --region "$AWS_REGION" \
      --user-pool-id "$USER_POOL_ID" \
      --username "$username" \
      --message-action SUPPRESS \
      --user-attributes "Name=custom:tenant_id,Value=$tenant" >/dev/null
  fi
  aws cognito-idp admin-set-user-password \
    --region "$AWS_REGION" \
    --user-pool-id "$USER_POOL_ID" \
    --username "$username" \
    --password "$password" \
    --permanent >/dev/null
}

token_for() {
  username="$1"
  password="$2"
  aws cognito-idp initiate-auth \
    --region "$AWS_REGION" \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id "$CLIENT_ID" \
    --auth-parameters "USERNAME=$username,PASSWORD=$password" \
    --query 'AuthenticationResult.AccessToken' \
    --output text
}

ensure_user alice "$ALICE_PASSWORD" "$alice_tenant"
ensure_user bob "$BOB_PASSWORD" "$bob_tenant"

alice="$(token_for alice "$ALICE_PASSWORD")"
bob="$(token_for bob "$BOB_PASSWORD")"

available="$(curl -sS "$API_URL/v1/availability?sku=GLV-100" -H "authorization: Bearer $alice")"
on_hand="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("available") or 0)' "$available")"
if [ "$on_hand" = "0" ]; then
  curl -sS -f -X POST "$API_URL/v1/stock" \
    -H "authorization: Bearer $alice" \
    -H 'content-type: application/json' \
    -d '{"sku":"GLV-100","onHand":10}'
fi

curl -sS -f -X POST "$API_URL/v1/catalog" \
  -H "authorization: Bearer $alice" \
  -H 'content-type: application/json' \
  -d '{"sku":"GLV-100","name":"Nitrile exam gloves","description":"Powder-free nitrile gloves","unitPriceCents":499}' >/dev/null

placed="$(curl -sS -f -X POST "$API_URL/v1/orders" \
  -H "authorization: Bearer $alice" \
  -H 'content-type: application/json' \
  -H 'idempotency-key: seed-glv-1' \
  -d '{"currency":"USD","lines":[{"sku":"GLV-100","quantity":1,"unitPriceCents":499}]}')"
order_id="$(python3 -c 'import json,sys; body=json.loads(sys.argv[1]);
assert body.get("orderId"); print(body["orderId"], end="")' "$placed")"

echo "order $order_id placed, waiting for allocated"
status=""
i=0
while [ "$i" -lt 20 ]; do
  body="$(curl -sS "$API_URL/v1/orders/$order_id" -H "authorization: Bearer $alice")"
  status="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("status") or "", end="")' "$body")"
  if [ "$status" = "allocated" ]; then
    break
  fi
  i=$((i + 1))
  sleep 3
done

if [ "$status" != "allocated" ]; then
  echo "order $order_id stayed $status"
  exit 1
fi

hidden="$(curl -sS -o /dev/null -w '%{http_code}' "$API_URL/v1/orders/$order_id" -H "authorization: Bearer $bob")"
if [ "$hidden" != "404" ]; then
  echo "bob saw alice's order, status $hidden"
  exit 1
fi

echo "seeded alice and bob; order $order_id allocated; bob got 404"
