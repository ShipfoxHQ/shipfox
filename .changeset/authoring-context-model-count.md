---
"@shipfox/api-agent-access-dto": major
"@shipfox/api-agent-access": minor
"@shipfox/workflow-templates": patch
---

Replaces the `models` list in the `get_workflow_authoring_context` result with `model_count`, so the tool stays small for any catalog size. The `write-a-workflow` skill now finds models through `list_workspace_models` and writes the chosen `provider`.
