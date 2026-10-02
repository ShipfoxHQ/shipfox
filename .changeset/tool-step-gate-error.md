---
"@shipfox/expression": minor
"@shipfox/api-workflows": minor
---

The gate of a tool step can read `step.error`, with the `code` and optional provider `status` of a failed tool call, or null when the call did not fail. A gate can accept an expected failure and tell a missing object from an outage.
