---
"@shipfox/api-definitions": patch
---

Sync rejects an agent integration whose `exclude` removes every tool that `include` selects, instead of persisting a selection that fails when the agent starts. The check applies to agent steps and agent files.
