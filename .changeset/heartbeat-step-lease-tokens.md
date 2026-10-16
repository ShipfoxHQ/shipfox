---
"@shipfox/api-auth-dto": minor
"@shipfox/api-auth": minor
"@shipfox/api-runners-dto": minor
"@shipfox/api-runners": minor
---

The job heartbeat renews step-scoped lease tokens, so a runner can hold one token per running step next to its job token.

- **Heartbeat:** the request body accepts `step_lease_tokens`, up to `HEARTBEAT_STEP_LEASE_TOKENS_MAX` (64). The response returns `step_lease_tokens`, a renewed token with its `step_id` and `attempt` for each valid token of the lease. A token from another job execution or runner session, or one without a step scope, is left out. The response schema reads a missing `step_lease_tokens` as an empty list.
- **Auth contract:** `renewStepLeaseTokens` re-mints step-scoped job lease tokens of one job execution and runner session with the same claims and a fresh expiry.
