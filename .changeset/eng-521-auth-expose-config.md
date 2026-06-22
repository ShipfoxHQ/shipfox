---
"@shipfox/api-auth": patch
---

Expose the auth `config` object through a new `@shipfox/api-auth/config` subpath export, so a module that already depends on auth can read auth-owned settings (such as `AUTH_JOB_LEASE_TOKEN_EXPIRES_IN`) without pulling in the full module graph from the package root.
