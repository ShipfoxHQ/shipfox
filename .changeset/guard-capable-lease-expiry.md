---
"@shipfox/api-runners": patch
---

Persists execution fences so lease-expired provider termination waits for capable runner work to stop.
Revokes managed runner sessions when a stuck job lease expires.
Adds RUNNER_EXECUTION_FENCE_MARGIN_SECONDS to configure the provider-side termination margin.
