---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-workflows": patch
"@shipfox/api-agent-access": patch
"@shipfox/client-workflows": patch
---

Fails a step or job when its `if` can't be evaluated, instead of skipping it. The step error reason is `condition_errored`, and the failure names the cause.
