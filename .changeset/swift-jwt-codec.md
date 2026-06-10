---
"@shipfox/node-jwt": minor
"@shipfox/api-auth": patch
---

Extracts the HS256 sign/verify mechanics into a shared `@shipfox/node-jwt` package and refactors auth user-token signing onto it, leaving the auth public API unchanged.
