---
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": minor
---

`list_workflow_execution_steps` returns the composite action that holds each step.

- **Parent:** every step carries `parent_step_id`, the id of the `composite` step that holds it, or null for a job step.
- **Schema:** the step type gains `composite`, and the step status reason gains `composite_skipped`.
