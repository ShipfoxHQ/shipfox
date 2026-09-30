---
'@shipfox/api-triggers': patch
---

Maps `definition-not-found` to 404 and `project-mismatch` to 409 for manual triggers, and `workflow-execution-payload-too-large` to 422 with `field`, `limit_bytes` and `measured_bytes` for both manual triggers and dev runs. These start failures no longer return a 500.
