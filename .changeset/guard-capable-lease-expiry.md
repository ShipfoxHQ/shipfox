---
"@shipfox/api-runners": patch
---

Persists execution fences so lease-expired provider termination waits for capable runner work to stop.
Revokes managed runner sessions when a stuck job lease expires.
Adds RUNNER_EXECUTION_FENCE_MARGIN_SECONDS to configure the provider-side termination margin.
Deploy heartbeat, lease-expiry maintenance, and runner-reconciliation replicas with the session-first lock order before enabling lease-expired termination; the old heartbeat order is not mixed-version compatible.
