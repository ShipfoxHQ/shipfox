---
"@shipfox/api-runners": patch
---

Remove the `RUNNER_CORRELATED_STALE_LEASE_MODE` setting and its shadow mode. The correlated stale-lease circuit breaker now always defers lease expiry during a suspected outage, which was the default. The `runners_job_lease_expiry_shadow` metric is gone with it.
