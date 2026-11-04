---
"@shipfox/api-agent": patch
"@shipfox/api-integration-linear": patch
---

A turn in an integration conversation that ends with no text now sends a short "Done." reply, so a Linear session no longer keeps its last tool call as the final activity. Slack gets the same reply.
