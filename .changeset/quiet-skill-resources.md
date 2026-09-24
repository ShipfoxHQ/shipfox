---
"@shipfox/workflow-templates": minor
"@shipfox/api-agent-access": minor
"@shipfox/api-agent-access-dto": major
"@shipfox/client-onboarding": patch
---

Serve embedded workflow skills as MCP resources with an index, manifest, and audited reads.

Remove `get_workflow_setup_guide` from the public MCP contract. The entry point is inactive, and no consumer outside this repository uses the tool.

Point the first workflow prompt at the template skill.
