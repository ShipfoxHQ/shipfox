#!/usr/bin/env bash
# Bootstraps the local-development Garage: cluster layout, log bucket, and a
# fixed dev access key matching the committed .env. Idempotent — safe to re-run.
# Run once after `docker compose up -d garage`.
set -euo pipefail

cd "$(dirname "$0")/../.."

GARAGE=(docker compose exec -T garage /garage)
BUCKET="shipfox-logs"
KEY_NAME="shipfox-dev"
ACCESS_KEY_ID="GKc0ffeec0ffeec0ffeec0ffee"
SECRET_ACCESS_KEY="c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ff"

# Assign and apply a single-node layout once (the node id is generated on first start).
if ! "${GARAGE[@]}" layout show 2>/dev/null | grep -q "dc1"; then
  node_id="$("${GARAGE[@]}" node id -q | cut -d@ -f1)"
  "${GARAGE[@]}" layout assign -z dc1 -c 1G "$node_id"
  "${GARAGE[@]}" layout apply --version 1
fi

"${GARAGE[@]}" bucket create "$BUCKET" 2>/dev/null || true
"${GARAGE[@]}" key import --yes -n "$KEY_NAME" "$ACCESS_KEY_ID" "$SECRET_ACCESS_KEY" 2>/dev/null || true
"${GARAGE[@]}" bucket allow --read --write --owner "$BUCKET" --key "$KEY_NAME" >/dev/null

echo "Garage ready: bucket '$BUCKET', key '$KEY_NAME' ($ACCESS_KEY_ID)."
