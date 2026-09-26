---
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": minor
"@shipfox/workflow-templates": patch
---

`list_workflow_templates` now marks each role with `from_project`. `get_workflow_template` accepts a project role that matches the project's source provider, and its errors now carry a `message` that names the unknown input, missing role, or invalid provider ID. The tool description and the create-workflow-from-template skill show the expected call shape.
