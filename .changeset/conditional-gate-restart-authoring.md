---
"@shipfox/workflow-document": minor
"@shipfox/api-definitions": minor
---

Accept a list of rules in `gate.on_failure` and an `if` condition on each rule. Definitions validate each condition, feedback, and restart target at the path of its rule, reject a rule with no `if` that is not the last rule, and store `on_failure` as a rule list.
