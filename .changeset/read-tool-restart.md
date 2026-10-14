---
"@shipfox/api-workflows": minor
---

Lets a tool step that reads restart its job through `gate.on_failure`, so a workflow can read again until a provider applies a change. A tool step that writes still fails its job without a restart.
