---
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": minor
"@shipfox/workflow-templates": minor
---

`get_workflow_template` accepts `options`, such as `{"pr_mode": "ready"}`, and returns `workflow_yaml` with only the chosen option blocks. The header keeps the legacy form. A call with an unknown option or choice explains the valid ones. The result also carries the manifest's `writes` and `prerequisites` as authored.

The create-workflow-from-template skill (revision 14) passes the answers as `options` and takes the applicable writes and prerequisites from the result. The template guides no longer repeat their prerequisites and expected writes.
