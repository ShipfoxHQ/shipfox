---
"@shipfox/api-registry-dto": minor
"@shipfox/api-registry": minor
---

Adds `getCatalog` and `getPackageIndex` to the Registry module. The catalog and each package index are served from the last good copy, so a registry outage after the first fetch keeps serving the stored data.
