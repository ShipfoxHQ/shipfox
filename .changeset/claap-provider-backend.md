---
"@shipfox/api-integration-claap": minor
"@shipfox/api-integration-claap-dto": minor
---

Adds the Claap provider. A Claap workspace connects with a pasted API key, and the key can be replaced without recreating the connection. Agent steps and tool steps get five read tools over Claap's hosted MCP server: `list_workspaces`, `get_recordings`, `get_recording`, `get_recording_transcript`, and `search_recording_transcripts`.
