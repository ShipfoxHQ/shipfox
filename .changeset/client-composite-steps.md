---
"@shipfox/client-workflows": minor
---

The run page groups the steps of a composite action under one row.

- **Step list:** a composite row opens to show the inner steps of that attempt. When a later step restarts the composite, each composite attempt holds the inner steps of its own pass. Nested composites indent, and inner step labels show the key path, such as `setup › changed_files`.
- **Step inspector:** a composite step shows the inputs and the outputs of its attempt.
- **Source tab:** an inner step opens the `action.yml` of its composite with its lines highlighted. A path above the file leads back to each calling `uses:` step.
- **Entities:** `Step` and `WorkflowJobStepSummary` gain the optional `parentStepId` field, and `StepSourceLocation` gains the optional `file` field.
