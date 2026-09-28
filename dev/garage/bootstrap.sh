#!/usr/bin/env sh
# Bootstraps the local-development Garage over its admin API: single-node layout, the shared
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
CORS_ALLOWED_ORIGINS="${GARAGE_CORS_ALLOWED_ORIGINS:-http://localhost:5173}"
# Shared development bucket plus the test bucket used by object-storage integration tests.
BUCKETS="shipfox shipfox-test"
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

# Bucket-level S3 calls signed with curl's SigV4 support, so bootstrap needs no aws CLI.
s3() {
  curl -fsS --aws-sigv4 "aws:amz:garage:s3" --user "$ACCESS_KEY_ID:$SECRET_ACCESS_KEY" "$@"
}

# Expire incomplete multipart uploads so a crashed compaction leaves no dangling parts.
# Provisioned here (infra), never by the worker, so the worker's S3 credentials stay limited
# to object read/write. Self-hosters should set the same rule on their bucket. Best-effort:
# a failed call logs curl's error and continues (dev then relies on the upload's
# abort-on-cancel; the rule only matters for a hard crash mid-upload).
lifecycle_configuration='<LifecycleConfiguration><Rule><ID>shipfox-abort-incomplete-multipart</ID><Status>Enabled</Status><Filter><Prefix></Prefix></Filter><AbortIncompleteMultipartUpload><DaysAfterInitiation>1</DaysAfterInitiation></AbortIncompleteMultipartUpload></Rule></LifecycleConfiguration>'
cors_origins="$(printf '%s' "$CORS_ALLOWED_ORIGINS" | jq -Rr 'split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0)) | map("<AllowedOrigin>\(@html)</AllowedOrigin>") | join("")')"
cors_configuration="<CORSConfiguration><CORSRule>$cors_origins<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><ExposeHeader>Content-Length</ExposeHeader><ExposeHeader>Content-Type</ExposeHeader><ExposeHeader>Content-Range</ExposeHeader><ExposeHeader>Accept-Ranges</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>"

for bucket in $BUCKETS; do
  s3 -X PUT "$S3_ENDPOINT/$bucket?lifecycle" -H 'Content-Type: application/xml' \
    --data-binary "$lifecycle_configuration" >/dev/null \
    || echo "Lifecycle rule skipped for '$bucket'."

  s3 -X PUT "$S3_ENDPOINT/$bucket?cors" -H 'Content-Type: application/xml' \
    --data-binary "$cors_configuration" >/dev/null \
    || echo "CORS rule skipped for '$bucket'."
done

echo "Garage ready: buckets [$BUCKETS], key '$KEY_NAME' ($ACCESS_KEY_ID), CORS origins [$CORS_ALLOWED_ORIGINS]."
