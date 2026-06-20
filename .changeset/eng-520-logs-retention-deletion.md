---
"@shipfox/api-logs": patch
---

Delete expired logs from both object storage and Postgres on an hourly cron, with a configurable horizon (`LOG_RETENTION_DAYS`, default 90), enforced by our own worker rather than bucket lifecycle rules so behavior is identical across object stores. A retention sweep drains closed streams past the horizon in batches, bounded by a self-imposed time budget so a timed-out run never overlaps the next; per stream it first hard-deletes the row (chunks cascading), guarded on the observed `object_key` so a concurrent compaction publish is left intact, then deletes the whole attempt object prefix (reclaiming orphan leaves left behind by a losing compaction attempt). Failed or raced rows are skipped for the rest of the run so a poison row cannot starve the streams behind it, and a `job_accounting` row is pruned only when its job has no remaining streams and no recent activity, so a live job's budget is never reset.
