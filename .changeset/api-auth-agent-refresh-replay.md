---
"@shipfox/api-auth": patch
---

Stops revoking agent grants when a rotated refresh token is replayed. A rotated token now keeps returning access tokens, without a new refresh token, until its own expiry, so several client processes sharing one sign-in no longer log each other out. Disconnecting the app and the 30-day sign-in cap still end access.
