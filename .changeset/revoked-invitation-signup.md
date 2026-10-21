---
"@shipfox/api-workspaces": patch
---

Rejects a revoked invitation during signup preflight. Signup with a revoked invitation token now fails with `invitation-token-invalid` before any user is created.
