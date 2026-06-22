---
"@shipfox/api-logs-dto": patch
"@shipfox/api-logs": patch
"@shipfox/runner-logs": patch
"@shipfox/runner-agent": patch
"@shipfox/runner-orchestration": patch
---

Forward agent step session entries into the logs module as opaque `agent_session` records: the runner tails the pi session file and forwards each verbatim entry over a shared log-stream sink, and the write path stores them with a configurable per-line size cap sized for inline base64 content.
