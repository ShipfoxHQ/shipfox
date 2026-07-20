---
"@shipfox/api-common-dto": minor
"@shipfox/api-auth": minor
"@shipfox/api-auth-dto": patch
"@shipfox/api-workspaces-dto": patch
"@shipfox/application-release": patch
---

Publishes a shared provider-neutral `emailSchema` in `@shipfox/api-common-dto` and adopts it across auth and workspace invitation inputs. Adds a read-only `findUserByEmail`/`EmailOwner` seam to `@shipfox/api-auth` for looking up the current owner of a normalized email without creating a session or mutating that user. Extends the packed external consumer gate to exercise both seams against PostgreSQL through installed tarballs.
