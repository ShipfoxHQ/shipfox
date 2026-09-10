---
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": minor
---

Adds bounded error details, exposes state-changing action tools in tools/list with their destructiveHint, idempotentHint, and openWorldHint annotations, and limits action calls to 10 per credential per minute on top of the existing shared window.
