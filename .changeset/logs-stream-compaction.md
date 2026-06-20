---
"@shipfox/api-logs": patch
---

Compact a closed log stream's hot Postgres chunks into one gzip-compressed NDJSON object in object storage, record the object key on the stream row, and delete the chunk rows. Compaction is a Temporal workflow started from the `logs.stream.closed` event (deduped per stream) on a dedicated task queue, with a reconcile cron backstop that re-drives any closed stream whose compaction never started or permanently failed. Crash-safe and idempotent: each attempt uploads to its own per-attempt object key and a single-winner publish (atomic object-key set and chunk delete, guarded by `object_key IS NULL`) records exactly one, so a slow or retried attempt can never overwrite a published object; a streamed-vs-table integrity check over chunk count, last seq, and byte total guards the irreversible chunk delete. Keeps Postgres bounded by in-flight work rather than retention.
