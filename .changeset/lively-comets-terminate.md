---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
---

Add a single reliable job-terminal event: `workflows.job.terminated` is now written in the same transaction as every terminal job-status flip (normal completion, DAG cancellation, lease-expiry resolution, and timeout), and the run-level `workflows.workflow_run.terminated` is emitted the same way. All workflows event names are aligned on one `WORKFLOWS_<entity>_<verb>` scheme, so the run and job terminal events read as the same event at two scopes.

Internal breaking change (`WORKFLOWS_JOB_COMPLETED` → `WORKFLOWS_JOB_STEPS_SETTLED`, `WORKFLOW_RUN_*` → `WORKFLOWS_WORKFLOW_RUN_*`, with matching DTO type renames) consumed only within this monorepo.
