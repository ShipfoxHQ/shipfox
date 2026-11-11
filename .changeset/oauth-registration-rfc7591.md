---
"@shipfox/api-auth-dto": patch
"@shipfox/api-auth": patch
---

OAuth dynamic client registration accepts `grant_types: ["authorization_code", "refresh_token"]` and ignores unknown client metadata such as `application_type`, as RFC 7591 requires. Clients built on the MCP SDK and `mcp-remote` can now register.
