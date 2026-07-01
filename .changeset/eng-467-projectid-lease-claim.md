---
"@shipfox/api-auth-dto": patch
"@shipfox/api-auth": patch
"@shipfox/api-runners": patch
"@shipfox/api-workflows": patch
---

Propagates `projectId` end-to-end into the job lease token. Workflows sources the `{workspaceId, projectId, workflowRunId, workflowRunAttemptId, jobId, jobExecutionId}` identity tuple and threads it through the runner pending/running job tables and lease claims. This is lease-shape groundwork for per-project log-ingest authorization; the stream-stamping consumer lands separately.
