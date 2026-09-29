---
"@shipfox/api-registry-dto": minor
"@shipfox/api-registry": minor
---

Adds `getCatalog` and `getPackageIndex` to the Registry module. It stores the last good copy of the catalog and of each package index, serves it, and refreshes a copy older than `REGISTRY_CATALOG_REFRESH_SECONDS` (default 900) in the background with `If-None-Match`. A registry outage after the first fetch keeps serving the stored copy.
