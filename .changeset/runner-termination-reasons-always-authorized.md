---
"@shipfox/api-runners": minor
---

Removes nine `RUNNER_TERMINATION_REASON_*_ENABLED` settings: registration deadline, activation timeout, runner unresponsive, lease expired, session exhausted, provider health failed, job cancelled, job timeout, and terminal state. The API always authorizes these terminations. `RUNNER_TERMINATION_REASON_STOPPING_TIMEOUT_ENABLED` stays and still defaults to `false`.

Self-hosted installs that left the five reasons that defaulted to `false` unset now get them enabled: registration deadline, runner unresponsive, lease expired, session exhausted, and provider health failed. Remove the nine settings from your API environment; leaving them set is harmless.

Before upgrading, note that lease-expired authorization is now always on. Upgrade or drain the heartbeat, lease-expiry maintenance, and runner-reconciliation replicas together, because the old heartbeat lock order is not compatible with the session-first order in a mixed-version rollout.
