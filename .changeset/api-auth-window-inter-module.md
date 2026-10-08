---
"@shipfox/api-auth-dto": minor
"@shipfox/api-auth": minor
---

Adds `startImpersonationWindow`, `stopImpersonationWindow`, and `findOpenImpersonationWindow` to the Auth inter-module contract. Each re-checks the actor's `admin-operator` role and returns window metadata only, never a token. Start and stop keep the browser's audit events, idempotency keys, and rate limits.
