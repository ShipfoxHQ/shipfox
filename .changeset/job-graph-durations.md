---
"@shipfox/client-workflows": patch
---

Show a per-job duration on each node of the workflow run job graph: a live queue
timer while a job waits for a runner, a live execution timer while it runs, and
the final span once it finishes. The value is derived purely from the job's
existing `queued_at`/`started_at`/`finished_at` timestamps and ticks every second
(paused when the tab is hidden, slowed to a calm 10s cadence under reduced
motion). Jobs that never executed (skipped, cancelled before dispatch) and
timestamps not yet projected show no duration rather than a placeholder.
