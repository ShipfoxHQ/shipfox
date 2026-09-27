---
"@shipfox/api-integration-core": patch
---

The integration tools gateway MCP route now accepts request bodies up to 2 MiB, up from Fastify's 1 MiB default. A `create_commit` call with a file near its 1,000,000-byte limit no longer fails after base64 encoding.
