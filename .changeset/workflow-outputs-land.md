---
"@shipfox/api-definitions-dto": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/api-workflows": minor
---

Adds the workflow outputs runtime. `WorkflowModel` gains optional `outputs` and `outputTypes`. When a run attempt succeeds, its outputs are evaluated with the job-output limits and stored on the attempt. An output that cannot be evaluated or is too large fails the attempt with the `output_invalid` or `output_too_large` status reason. The lifecycle event context returns `run.outputs`, and run creation errors can name the `workflow.outputs` field.
