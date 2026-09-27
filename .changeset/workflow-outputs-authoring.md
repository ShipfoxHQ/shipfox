---
"@shipfox/workflow-document": minor
"@shipfox/expression": minor
"@shipfox/api-definitions": minor
"@shipfox/api-workflows": patch
---

Accepts top-level workflow `outputs`. The document schema takes a map from output names to templates, with the job-outputs entry limit. The new `workflow.outputs` expression field reads the `jobs`, `inputs`, `vars`, `workflow`, `run`, `trigger`, and `event` contexts. Definitions normalize the map into `WorkflowModel.outputs` and `outputTypes` and type-check each output against the declared job outputs, so a reference to an undeclared job output is a sync error. The workflow outputs runtime now evaluates under the `workflow.outputs` field.
