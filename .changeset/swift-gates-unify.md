---
"@shipfox/expression": patch
"@shipfox/api-definitions": patch
"@shipfox/api-workflows": patch
---

Evaluate the step gate `success_if` over the `step` self-root (`step.exit_code`, `step.status`) and job `success` over the full typed executions context, both validated against the shared context registry; authored gate expressions move from `exit_code` to `step.exit_code` and job-success now fails closed on a runtime evaluation error.
