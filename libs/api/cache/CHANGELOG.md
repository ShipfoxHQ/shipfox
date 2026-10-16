# @shipfox/api-cache

## 34.0.0

### Minor Changes

- 7c11451: Members can list and delete cache entries and read storage usage. The Cache module adds routes to list the scopes and entries of a project, delete one entry or a whole scope, read the stored bytes, limit, project totals, and recent deletions of a workspace, and read and set the retention, which only a workspace admin can change. A dev sandbox is listed with its user. A deletion removes the stored archive and records a `manual` deletion. The Cache contract gains `listCacheEntries`, `getCacheUsage`, and `deleteCacheEntries`. The Shipfox MCP server gains the read tools `list_cache_entries` and `get_cache_usage` and the action tool `delete_cache_entries`. `createCacheModule` now takes a `projects` client, and `createAgentAccessModule` takes an optional `cache` client.
- 2526ccf: Adds the Cache module and the routes a runner calls to save and restore a job cache. A save reserves a key, uploads the archive straight to object storage through signed part URLs, and commits. A restore finds the entry by exact key or restore key and signs a download URL. A dev run saves into a sandbox of the user who started it. The object store gains signed multipart uploads and a `publicEndpoint` option for signed URLs. The Workflows contract gains `getWorkflowRunOrigin`. Set `CACHE_STORAGE_S3_*` to give the cache its own bucket.
- 67c51ec: Usage records the stored cache bytes of each project once an hour. The Usage contract gains `recordStorageSamples`, which returns the counts of recorded samples and duplicates, and the `listStorageSamples` replay cursor. Usage publishes `usage.storage_sample.recorded` for each new sample. A sample holds quantities only. The Cache module takes a `usage` client and samples `ready` entries at minute 5 of every hour. It records one sample per project, keyed by project and clock hour, so a repeated run records nothing twice.
- 0bb46e1: Adds the cache sweeper. A Temporal cron runs every 10 minutes: it expires entries idle past the workspace's retention, removes uploads older than two hours with their multipart upload, and evicts the least recently used entries of a workspace over its storage limit. Eviction also runs at commit, and a reserve for an entry larger than the limit answers `too_large`. `createCacheModule` accepts an optional `storage.policy` that sets the limit of each workspace, and `defaultModules` forwards it through `cacheModuleOptions`. Set `CACHE_WORKSPACE_MAX_BYTES` to bound every workspace when no policy is composed.

### Patch Changes

- Updated dependencies [af0e24b]
- Updated dependencies [7d20d04]
- Updated dependencies [3f1363c]
- Updated dependencies [8937e15]
- Updated dependencies [16d18f4]
- Updated dependencies [ba1aff7]
- Updated dependencies [7c11451]
- Updated dependencies [2526ccf]
- Updated dependencies [67c51ec]
- Updated dependencies [c4f486b]
- Updated dependencies [7fddfc5]
- Updated dependencies [9d7c039]
- Updated dependencies [2e5a311]
- Updated dependencies [2d009f4]
- Updated dependencies [b9a53b2]
- Updated dependencies [dc8065c]
- Updated dependencies [c06262b]
- Updated dependencies [24ea599]
- Updated dependencies [205afb5]
- Updated dependencies [a73e712]
- Updated dependencies [f769d90]
- Updated dependencies [593142d]
- Updated dependencies [f1f520f]
- Updated dependencies [ef7cf4a]
- Updated dependencies [f7e0fb7]
- Updated dependencies [fc455ac]
- Updated dependencies [67e55ea]
- Updated dependencies [ecc70c2]
- Updated dependencies [6b01f3d]
- Updated dependencies [21c993b]
- Updated dependencies [3869c1d]
- Updated dependencies [c06262b]
- Updated dependencies [a15e118]
- Updated dependencies [4aad893]
- Updated dependencies [c6f2ae3]
- Updated dependencies [fafbe84]
- Updated dependencies [737c625]
- Updated dependencies [507915a]
- Updated dependencies [2c36559]
- Updated dependencies [395e11d]
- Updated dependencies [94e77bc]
- Updated dependencies [2100749]
- Updated dependencies [9bac67e]
- Updated dependencies [dd20040]
- Updated dependencies [daf0208]
- Updated dependencies [a32c90c]
- Updated dependencies [6b2a308]
- Updated dependencies [2ab4025]
- Updated dependencies [0b661c9]
- Updated dependencies [89a6cc7]
  - @shipfox/api-workflows-dto@34.0.0
  - @shipfox/api-auth-context@34.0.0
  - @shipfox/api-cache-dto@34.0.0
  - @shipfox/node-object-storage@0.3.0
  - @shipfox/api-usage-dto@34.0.0
  - @shipfox/api-projects-dto@34.0.0
  - @shipfox/node-postgres@0.6.0
  - @shipfox/node-fastify@0.5.0
  - @shipfox/node-module@1.2.0
  - @shipfox/node-opentelemetry@0.7.0
  - @shipfox/node-temporal@0.6.0
  - @shipfox/node-drizzle@0.3.7
