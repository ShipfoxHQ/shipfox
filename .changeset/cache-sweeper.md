---
"@shipfox/api-cache": minor
"@shipfox/api-server": minor
---

Adds the cache sweeper. A Temporal cron runs every 10 minutes: it expires entries idle past the workspace's retention, removes uploads older than two hours with their multipart upload, and evicts the least recently used entries of a workspace over its storage limit. Eviction also runs at commit, and a reserve for an entry larger than the limit answers `too_large`. `createCacheModule` accepts an optional `storage.policy` that sets the limit of each workspace, and `defaultModules` forwards it through `cacheModuleOptions`. Set `CACHE_WORKSPACE_MAX_BYTES` to bound every workspace when no policy is composed.
