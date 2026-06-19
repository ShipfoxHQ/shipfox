---
"@shipfox/api-integration-debug": patch
"@shipfox/api-integration-core": patch
---

Debug integration: on each API startup (when the debug provider is enabled), emit an `INTEGRATION_SOURCE_COMMIT_PUSHED` for the debug `platform` repo on its main branch, for every active debug connection. This forces a re-sync of the debug workflow definitions on every boot. Only the typed event is emitted (not the generic `INTEGRATION_EVENT_RECEIVED` envelope), so it never re-runs `on_push` workflows.
