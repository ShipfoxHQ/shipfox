---
"@shipfox/api-logs": patch
---

Compact a closed log stream's hot Postgres chunks into one gzip-compressed NDJSON object in object storage, record the object key on the stream row, and delete the chunk rows. Compaction is a Temporal workflow started from the `logs.stream.closed` event (deduped per stream) on a dedicated task queue, with a reconcile cron backstop that re-drives any closed stream whose compaction never started or permanently failed. Crash-safe and idempotent: the stable object key makes the upload overwrite-idempotent, and a streamed-vs-table integrity check guards the irreversible chunk delete. Keeps Postgres bounded by in-flight work rather than retention.
