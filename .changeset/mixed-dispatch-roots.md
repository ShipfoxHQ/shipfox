---
"@shipfox/api-workflows": patch
---

A step field segment that mixes `steps` with an earlier context, such as `event`, `run`, `workflow`, `trigger`, `inputs`, `job`, `needs`, or `executions`, now resolves at step dispatch instead of failing with `config_unresolvable`. When a field reads a context that its fill site does not provide, the error no longer suggests `has(x)`.
