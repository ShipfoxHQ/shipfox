---
'@shipfox/api-workflows-dto': minor
'@shipfox/api-workflows': minor
'@shipfox/api-triggers-dto': minor
'@shipfox/api-triggers': minor
---

Names the cause of a refused start when an integration connection or tool cannot be materialized. `agent-integration-materialization-failed` carries a `reason` (`connection-missing`, `connection-provider-mismatch`, `source-connection-missing`, `tool-unknown` or `no-tools-selected`) with the `connection` and `tool` where they apply, and the job and step it came from. They reach the inter-module error, the 422 `details` (`reason`, `connection`, `tool`, `job_key`, `step`) and the trigger diagnostic. Setup failures keep no reason. Every new field is optional, so stored diagnostics still map.
