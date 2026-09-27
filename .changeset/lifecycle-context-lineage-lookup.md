---
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/api-workflows": patch
---

Shipfox lifecycle events now resolve their workflow context by lineage, so `source: shipfox` triggers dispatch instead of being dropped. The definitions contract adds a `getWorkflow` method for this lookup.
