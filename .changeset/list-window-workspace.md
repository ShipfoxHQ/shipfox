---
"@shipfox/api-workspaces": patch
---

`GET /workspaces` lists the workspaces the session token grants when the session is impersonated.
An impersonation window grants its workspace through the token only, so the client could not enter it.
