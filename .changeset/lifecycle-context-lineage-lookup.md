---
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/api-workflows": patch
---

Adds the `getWorkflow` definitions inter-module method, which looks up a workflow by its lineage id. Shipfox lifecycle events now resolve their workflow context through it, so `source: shipfox` triggers dispatch instead of being dropped.
