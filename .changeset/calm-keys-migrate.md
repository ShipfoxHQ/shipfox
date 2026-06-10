---
"@shipfox/api-auth": minor
"@shipfox/api-auth-context": minor
"@shipfox/api-auth-dto": minor
"@shipfox/api-runners": patch
"@shipfox/api-runners-dto": patch
---

Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims.
