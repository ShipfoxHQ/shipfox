---
"@shipfox/api-workflows": patch
"@shipfox/api-server": patch
---

Failed tool calls mark their trace span as an error, and the API traces outbound `fetch` requests.
