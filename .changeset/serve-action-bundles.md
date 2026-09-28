---
"@shipfox/api-workflows": patch
---

Adds `GET /runs/jobs/current/steps/:stepId/action-bundle`, which returns the gzipped action bundle for the runner's currently leased action step. The step must be the lease's current step and an `action` step. The digest comes from the step config, and a missing snapshot returns 404 `action-snapshot-not-found`. Responses are sent with `cache-control: no-store`.
