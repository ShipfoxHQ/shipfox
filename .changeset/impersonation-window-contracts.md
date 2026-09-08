---
"@shipfox/api-auth": major
"@shipfox/api-auth-dto": minor
---

Adds impersonation window command and read contracts plus `AUTH_IMPERSONATION_WINDOW_MAX`; when impersonation is enabled, `@shipfox/api-auth` rejects JWT lifetimes below one minute at startup.
