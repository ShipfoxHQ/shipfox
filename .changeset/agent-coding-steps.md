---
"@shipfox/workflow-document": patch
"@shipfox/api-definitions": patch
"@shipfox/api-workflows": patch
"@shipfox/api-workflows-dto": patch
"@shipfox/runner-execution": patch
"@shipfox/runner-orchestration": patch
---

Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
