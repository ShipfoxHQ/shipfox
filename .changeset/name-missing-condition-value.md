---
"@shipfox/expression": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-workflows": patch
"@shipfox/api-agent-access": patch
"@shipfox/client-workflows": minor
---

A step or job `if` condition that cannot be evaluated now records the error in its evaluation trace, with the missing path and the status of the step or job it reads. The run UI says which value is missing and why. A step that has not run exposes empty `outputs`, so `has(steps.x.outputs.y)` returns `false` instead of failing.
