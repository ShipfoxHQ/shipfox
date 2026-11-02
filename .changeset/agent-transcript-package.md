---
"@shipfox/agent-transcript": minor
"@shipfox/api-logs": patch
---

Moves the agent session parser out of Logs into the new `@shipfox/agent-transcript` package, so Logs and Agent turn session entries into `SessionView` rows with one parser. Logs reads and ingestion behave as before.
