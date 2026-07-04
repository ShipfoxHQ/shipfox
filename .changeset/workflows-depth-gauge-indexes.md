---
"@shipfox/api-workflows": patch
---

Refold the workflows migration baseline and tune its indexes. Drops the redundant `step_attempts(job_execution_id)` index, which was fully covered by the `(job_execution_id, execution_order)` unique index. Adds partial `WHERE status = 'running'` indexes on `workflow_runs` and `job_executions` so the running-depth service gauge counts only active rows instead of sequentially scanning the full history on every scrape. No behavior or API change.
