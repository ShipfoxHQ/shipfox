---
"@shipfox/api-agent-access-dto": major
"@shipfox/api-agent-access": major
"@shipfox/workflow-templates": patch
---

Replaces the `models` list in the `get_workflow_authoring_context` result with `model_count`. The `write-a-workflow` skill now finds models through `list_workspace_models` and writes the chosen `provider`.
