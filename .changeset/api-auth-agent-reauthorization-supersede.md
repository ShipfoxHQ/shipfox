---
"@shipfox/api-auth": patch
---

Signing in again to an app that already has an agent grant no longer revokes the refresh token other client processes hold. The old token is marked rotated and keeps returning access tokens until its own expiry, so a new sign-in from another project or machine no longer logs the others out. Grant cleanup now counts rotated refresh tokens that have not expired as usable.
