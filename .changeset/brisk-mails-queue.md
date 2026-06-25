---
"@shipfox/api-auth-dto": minor
"@shipfox/api-workspaces-dto": minor
"@shipfox/api-auth": patch
"@shipfox/api-workspaces": patch
---

Queues auth and workspace transactional emails through module-owned outbox events so account verification, password reset, and invitation sends retry outside request transactions.
