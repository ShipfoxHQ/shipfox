---
"@shipfox/api-auth": minor
"@shipfox/api-auth-dto": minor
---

Adds the `auth.user.signed_in` Auth outbox event contract.
Successful primary authentication emits `auth.user.signed_in` with the authenticated `userId`.
