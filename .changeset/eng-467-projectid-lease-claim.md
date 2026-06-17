---
"@shipfox/api-auth-dto": patch
"@shipfox/api-auth": patch
"@shipfox/api-runners": patch
"@shipfox/api-workflows": patch
---

Propagates `projectId` end-to-end into the job lease token. Workflows sources the `{workspaceId, projectId, runId}` identity tuple from the loaded run and threads `projectId` through the runner pending/running job tables and the lease claims, so a claimed job's lease now carries a signed `projectId` alongside `runId`, `workspaceId`, and `jobId`. This is lease-shape groundwork for per-project log-ingest authorization; the stream-stamping consumer lands separately.
