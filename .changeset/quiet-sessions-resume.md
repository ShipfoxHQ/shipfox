---
"@shipfox/api-agent-dto": minor
"@shipfox/api-agent": patch
"@shipfox/api-workflows": patch
---

Recover completed attempts' session claims before dispatching the next writer, so delayed background releases do not fail sequential agent steps.
