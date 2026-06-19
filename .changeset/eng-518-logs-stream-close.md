---
"@shipfox/api-logs": patch
---

Close a log stream so it becomes eligible for compaction. A committed `end` record declared-closes the stream inside the append transaction, and a `WORKFLOWS_JOB_TERMINATED` subscriber arms a grace-then-close Temporal workflow that force-closes any stream the runner never ended (appending a `runner_lost` tombstone and marking it truncated). Both paths route through one guarded close that writes a single `logs.stream.closed` outbox event, and a closed-stream guard drops later appends. Adds `closed_at` and three partial indexes to the stream table.
