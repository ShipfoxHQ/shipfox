# @shipfox/api-cache-dto

## 34.0.0

### Minor Changes

- 7c11451: Members can list and delete cache entries and read storage usage. The Cache module adds routes to list the scopes and entries of a project, delete one entry or a whole scope, read the stored bytes, limit, project totals, and recent deletions of a workspace, and read and set the retention, which only a workspace admin can change. A dev sandbox is listed with its user. A deletion removes the stored archive and records a `manual` deletion. The Cache contract gains `listCacheEntries`, `getCacheUsage`, and `deleteCacheEntries`. The Shipfox MCP server gains the read tools `list_cache_entries` and `get_cache_usage` and the action tool `delete_cache_entries`. `createCacheModule` now takes a `projects` client, and `createAgentAccessModule` takes an optional `cache` client.
- 2526ccf: Adds the Cache module and the routes a runner calls to save and restore a job cache. A save reserves a key, uploads the archive straight to object storage through signed part URLs, and commits. A restore finds the entry by exact key or restore key and signs a download URL. A dev run saves into a sandbox of the user who started it. The object store gains signed multipart uploads and a `publicEndpoint` option for signed URLs. The Workflows contract gains `getWorkflowRunOrigin`. Set `CACHE_STORAGE_S3_*` to give the cache its own bucket.
