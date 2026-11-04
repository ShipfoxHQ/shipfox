---
"@shipfox/api-agent": patch
---

A write tool call in a conversation that times out, or fails on the last attempt after it began, now stores the outcome `unknown` instead of an error. The provider may have applied the write, so the model reads the state before it tries again.
