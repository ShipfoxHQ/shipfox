---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": patch
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": patch
"@shipfox/client-workflows": patch
---

A failed step attempt shows which `gate.on_failure` rule restarted the job, that no rule applied, or which rule could not be evaluated. The run page and the Agent Access step attempt tools return the same decision, and a step with a rule list shows the attempt limit of the rule its latest restart used. Agent Access no longer blanks the first root of an evaluation trace entry.
