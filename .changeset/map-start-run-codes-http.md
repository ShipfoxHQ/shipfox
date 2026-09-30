---
'@shipfox/api-triggers': patch
---

Maps `definition-not-found` to 404, `project-mismatch` to 409 and `workflow-execution-payload-too-large` to 422 with `field`, `limit_bytes` and `measured_bytes` when a manual trigger or dev run fails to start. These start failures no longer return a 500.
