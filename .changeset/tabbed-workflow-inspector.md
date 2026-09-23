---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/client-usage": minor
"@shipfox/client-workflows": minor
"@shipfox/react-ui": minor
---

Adds a shared tabbed inspector for workflow runs and job executions with compact summary facts and a simplified usage breakdown. The run overview DTO gains `secret_inputs`, which lists each secret input's name and source key but never its value. Adds `@shipfox/react-ui/inspector`: the inspector host, header, facts, tabs, and full-width sections with property rows, plus the `background-inspector-*` surface tokens.
