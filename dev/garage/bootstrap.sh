#!/usr/bin/env sh
# Bootstraps the local-development Garage over its admin API: single-node layout,
# log bucket, and a fixed dev access key matching the committed .env. Idempotent,
# so re-running is safe. The garage-init compose service runs it automatically;
# it is also launchable by hand (defaults target the published localhost ports).
set -eu

GARAGE_URL="${GARAGE_URL:-http://localhost:3903}"
ADMIN_TOKEN="${GARAGE_ADMIN_TOKEN:-shipfox-dev-admin-token}"
BUCKET="shipfox-logs"
KEY_NAME="shipfox-dev"
ACCESS_KEY_ID="GKc0ffeec0ffeec0ffeec0ffee"
SECRET_ACCESS_KEY="c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ff"
ZONE="dc1"
CAPACITY=1000000000 # 1G, in bytes

api() {
  method="$1"
  path="$2"
  body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "$GARAGE_URL/v1$path" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -fsS -X "$method" "$GARAGE_URL/v1$path" \
      -H "Authorization: Bearer $ADMIN_TOKEN"
  fi
}

# Assign and apply a single-node layout once (the node id is generated on first start).
status="$(api GET /status)"
node_id="$(printf '%s' "$status" | jq -r '.node')"
if [ "$(printf '%s' "$status" | jq -r --arg id "$node_id" '(.layout.roles // []) | any(.id == $id)')" != "true" ]; then
  next_version="$(printf '%s' "$status" | jq -r '.layout.version + 1')"
  api POST /layout "[{\"id\":\"$node_id\",\"zone\":\"$ZONE\",\"capacity\":$CAPACITY,\"tags\":[]}]" >/dev/null
  api POST /layout/apply "{\"version\":$next_version}" >/dev/null
fi

# Bucket and key creation 409 when they already exist; ignore that and reconcile below.
api POST /bucket "{\"globalAlias\":\"$BUCKET\"}" >/dev/null 2>&1 || true
api POST /key/import "{\"name\":\"$KEY_NAME\",\"accessKeyId\":\"$ACCESS_KEY_ID\",\"secretAccessKey\":\"$SECRET_ACCESS_KEY\"}" >/dev/null 2>&1 || true

bucket_id="$(api GET "/bucket?globalAlias=$BUCKET" | jq -r '.id')"
api POST /bucket/allow "{\"bucketId\":\"$bucket_id\",\"accessKeyId\":\"$ACCESS_KEY_ID\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":true}}" >/dev/null

echo "Garage ready: bucket '$BUCKET', key '$KEY_NAME' ($ACCESS_KEY_ID)."
