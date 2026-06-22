---
"@shipfox/api-logs": patch
---

Reap log streams that leak open after the one-shot job-terminated close. That sweep snapshots a job's open streams once, so a stream whose first append lands after it ran was never closed and leaked forever: open streams are invisible to compaction and retention (both keyed on `state = 'closed'`). A new `reapStaleOpenStreamsCron` (every 10 minutes, on the logs lifecycle queue, staggered off the retention sweep) force-closes any stream left open past the job-lease window, marking it truncated so it re-enters the compaction and retention lifecycle. Adds the `LOG_STREAM_REAP_AFTER_SECONDS` config (default 7200s; startup validates it exceeds the configured `AUTH_JOB_LEASE_TOKEN_EXPIRES_IN`, read from auth's `config`) and the `logs_attempt_streams_open_age_idx` partial index.
