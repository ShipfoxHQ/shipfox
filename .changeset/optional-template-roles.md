---
"@shipfox/workflow-templates": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": minor
---

Templates can declare optional roles. A role with `optional: true` gives a `question` and a `tradeoff`. When the role is unbound, `composeTemplate` drops its parts. `composeTemplate` now writes the `# shipfox-template:` header from the bound roles, so base workflows must no longer declare it. `templateRoleBindings` lists every supported binding, with each optional role both bound and unbound.

`list_workflow_templates` returns `optional`, `question`, and `tradeoff` for each role. It computes `compatible` and `missing_providers` from required roles only. `get_workflow_template` accepts optional roles being left out. The create-workflow-from-template skill asks about an optional role only when the workspace has a connection for it.
