---
"@shipfox/api-workflows": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": patch
---

Workflows reads `gate.on_failure` as one rule or a list of rules with an optional `if`, restarts from the first rule that applies, and records the decision on the step attempt's gate result.
