---
"@shipfox/api-cache-dto": minor
"@shipfox/api-cache": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": minor
"@shipfox/api-server": patch
---

Members can list and delete cache entries and read storage usage. The Cache module adds routes to list the scopes and entries of a project, delete one entry or a whole scope, read the stored bytes, limit, project totals, and recent deletions of a workspace, and read and set the retention, which only a workspace admin can change. A dev sandbox is listed with its user. A deletion removes the stored archive and records a `manual` deletion. The Cache contract gains `listCacheEntries`, `getCacheUsage`, and `deleteCacheEntries`. The Shipfox MCP server gains the read tools `list_cache_entries` and `get_cache_usage` and the action tool `delete_cache_entries`. `createCacheModule` now takes a `projects` client, and `createAgentAccessModule` takes an optional `cache` client.
