---
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-github": patch
---

Integration providers can serve file tools, and leased action steps download their files through the tool gateway.

- **Adapter:** `AgentToolsProvider` gains an optional `downloadFile({connection, toolId, arguments, signal})`, which returns `{body, mediaType, filename?, size?}`. A provider whose catalog declares a `file` tool implements it. It passes `signal` to the provider fetch and to the body, so an abandoned transfer stops. `MAX_AGENT_TOOL_FILE_BYTES` is the 100 MiB per-file limit.
- **Errors:** `IntegrationProviderErrorReason` adds `file-too-large` and `file-location-not-allowed`.
- **Route:** `POST /runs/jobs/current/integration-tools/download` takes `{connection_slug, tool, arguments}` from a leased action step. It authorizes like the MCP route: the frozen grant, the live connection state, and repository scope. It streams the file with `content-type`, `x-shipfox-filename` (RFC 5987), and `x-shipfox-size` when known, and cuts the stream past 100 MiB. The deadline is the smaller of `x-shipfox-deadline` (remaining milliseconds) and 5 minutes. A runner disconnect aborts the provider transfer. Errors before the first byte use the gateway codes. Agent steps get `leased-step-not-action`.
- **Audit:** downloads are audited with the `action` caller, `resultKind: 'file'`, and the streamed byte count.
- **Frozen result kind:** the gateway reads each tool's frozen `result` kind. A tool frozen as a file tool stays out of MCP `listTools`, even when the live catalog no longer lists it.
