---
"@shipfox/api-triggers-dto": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-triggers": patch
"@shipfox/api-agent-access": patch
"@shipfox/api-workflows": patch
---

Dev runs accept action uploads. `POST /dev-runs` and the `create_dev_run` MCP tool take an `actions` field: whole action directories, each replacing the ref's copy of its `uses` path. Both routes accept bodies up to 4 MiB, because JSON escaping inflates the 1 MiB of text the definitions core allows. The `create_dev_run` description tells agents which files to send. The run DTO's `dev_source` gains `local_actions`, the uploaded action paths. It defaults to an empty list for older runs.
