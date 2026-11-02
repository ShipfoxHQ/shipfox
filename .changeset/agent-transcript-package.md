---
"@shipfox/agent-transcript": minor
"@shipfox/api-logs": patch
---

Adds `@shipfox/agent-transcript`, which turns pi and Claude agent session entries into `SessionView` rows through `parseSessionRecord`, with helpers for the Claude parser state. Logs now uses it in place of its own parser, and its reads and ingestion behave as before.
