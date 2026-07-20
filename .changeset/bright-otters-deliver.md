---
"@shipfox/node-mailer": minor
"@shipfox/api-auth": patch
"@shipfox/api-workspaces": patch
---

Adds a configured shared mailer that owns SMTP delivery settings. `@shipfox/api-auth` and `@shipfox/api-workspaces` drop their own mailer environment variables and factory logic and use the shared `mailer` from `@shipfox/node-mailer` instead.
