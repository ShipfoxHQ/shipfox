---
"@shipfox/api-logs-dto": minor
"@shipfox/api-logs": minor
---

Add the session-authenticated log read endpoint: `GET /steps/:stepId/attempts/:attempt/logs?cursor=N`. One cursor endpoint serves both the live tail and the full history of a step attempt, workspace-scoped through the stream row's denormalized `workspaceId` (a 404 covers both a missing stream and a cross-workspace step, so existence never leaks).

- Open or closed-but-uncompacted streams return inline NDJSON read from the hot Postgres chunks, walked by chunk `seq` so server-injected control tombstones (`capped`, `runner_lost`) interleave with runner bytes exactly as compaction concatenates them. The inline bytes are therefore byte-identical to the decompressed compacted object. Pages are bounded by `LOG_READ_INLINE_MAX_BYTES` (default 1 MiB), with a `has_more` flag and a `next_cursor` the client drains before it tails.
- Compacted streams (`object_key` set) return a presigned GET URL (`LOG_READ_URL_TTL_SECONDS`, default 3600) plus `total_bytes`, `expires_at`, and `truncated`, so the browser fetches the object directly and API egress is bypassed.
- `@shipfox/api-logs-dto` gains `readLogsQuerySchema` and the `readLogsResponseSchema` discriminated union (`inline` or `presigned`) so the backend, client, and E2E helpers share one contract. `@shipfox/api-logs` adds the `@aws-sdk/s3-request-presigner` dependency.
