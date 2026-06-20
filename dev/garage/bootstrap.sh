#!/usr/bin/env sh
# Bootstraps the local-development Garage over its admin API: single-node layout, the log
# buckets (dev + test), and a fixed dev access key matching the committed .env. Idempotent,
# so re-running is safe. The garage-init compose service runs it automatically; it is also
# launchable by hand (defaults target the published localhost ports).
#
# Uses the Garage v2 admin API (the v1 endpoints were removed in the v2 image): PascalCase
# /v2 operations rather than the old /v1/<noun> paths.
set -eu

GARAGE_URL="${GARAGE_URL:-http://localhost:3903}"
ADMIN_TOKEN="${GARAGE_ADMIN_TOKEN:-shipfox-dev-admin-token}"
S3_ENDPOINT="${GARAGE_S3_ENDPOINT:-http://localhost:3900}"
# Dev bucket plus the test bucket the @shipfox/api-logs suite uploads to against real Garage.
BUCKETS="shipfox-logs shipfox-logs-test"
KEY_NAME="local-dev"
ACCESS_KEY_ID="GK000000000000000000000000"
SECRET_ACCESS_KEY="0000000000000000000000000000000000000000000000000000000000000000"
ZONE="local"
CAPACITY=1000000000 # 1G, in bytes

api() {
  method="$1"
  path="$2"
  body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "$GARAGE_URL/v2$path" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -fsS -X "$method" "$GARAGE_URL/v2$path" \
      -H "Authorization: Bearer $ADMIN_TOKEN"
  fi
}

# Assign and apply a single-node layout once (skipped when this node already has a role).
layout="$(api GET /GetClusterLayout)"
if [ "$(printf '%s' "$layout" | jq -r '.roles | length')" = "0" ]; then
  node_id="$(api GET /GetClusterStatus | jq -r '.nodes[0].id')"
  next_version="$(printf '%s' "$layout" | jq -r '.version + 1')"
  api POST /UpdateClusterLayout "{\"roles\":[{\"id\":\"$node_id\",\"zone\":\"$ZONE\",\"capacity\":$CAPACITY,\"tags\":[]}]}" >/dev/null
  api POST /ApplyClusterLayout "{\"version\":$next_version}" >/dev/null
fi

# Key and bucket creation 4xx when they already exist; ignore that and reconcile below.
api POST /ImportKey "{\"name\":\"$KEY_NAME\",\"accessKeyId\":\"$ACCESS_KEY_ID\",\"secretAccessKey\":\"$SECRET_ACCESS_KEY\"}" >/dev/null 2>&1 || true

for bucket in $BUCKETS; do
  api POST /CreateBucket "{\"globalAlias\":\"$bucket\"}" >/dev/null 2>&1 || true
  bucket_id="$(api GET "/GetBucketInfo?globalAlias=$bucket" | jq -r '.id')"
  api POST /AllowBucketKey "{\"bucketId\":\"$bucket_id\",\"accessKeyId\":\"$ACCESS_KEY_ID\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":true}}" >/dev/null
done

# Expire incomplete multipart uploads so a crashed compaction leaves no dangling parts.
# Provisioned here (infra), never by the worker, so the worker's S3 credentials stay limited
# to object read/write. Self-hosters should set the same rule on their bucket. Best-effort:
# skipped when the aws CLI or the store's lifecycle API is unavailable (dev then relies on the
# upload's abort-on-cancel; the rule only matters for a hard crash mid-upload).
if command -v aws >/dev/null 2>&1; then
  for bucket in $BUCKETS; do
    AWS_ACCESS_KEY_ID="$ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$SECRET_ACCESS_KEY" AWS_REGION=garage \
      aws --endpoint-url "$S3_ENDPOINT" s3api put-bucket-lifecycle-configuration \
      --bucket "$bucket" \
      --lifecycle-configuration '{"Rules":[{"ID":"shipfox-abort-incomplete-multipart","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}' \
      >/dev/null 2>&1 || echo "Lifecycle rule skipped for '$bucket' (aws CLI or lifecycle API unavailable)."
  done
fi

echo "Garage ready: buckets [$BUCKETS], key '$KEY_NAME' ($ACCESS_KEY_ID)."
