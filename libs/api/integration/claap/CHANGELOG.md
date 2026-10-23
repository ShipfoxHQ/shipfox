# @shipfox/api-integration-claap

## 34.0.0

### Minor Changes

- b183992: Adds the Claap provider. A Claap workspace connects with a pasted API key, and the key can be replaced without recreating the connection. Agent steps and tool steps get five read tools over Claap's hosted MCP server: `list_workspaces`, `get_recordings`, `get_recording`, `get_recording_transcript`, and `search_recording_transcripts`.

### Patch Changes

- 0461349: `get_recording` and `get_recording_transcript` now declare in their input schema that a call needs `recordingId` or `recordingUrl`, so a tool step without either fails validation before it reaches Claap.
- Updated dependencies [16d18f4]
- Updated dependencies [c4f486b]
- Updated dependencies [b183992]
- Updated dependencies [2d009f4]
- Updated dependencies [c06262b]
- Updated dependencies [e5872d5]
- Updated dependencies [9e173c3]
- Updated dependencies [f769d90]
- Updated dependencies [c8e0869]
- Updated dependencies [21c993b]
- Updated dependencies [1d94e37]
- Updated dependencies [041ae63]
- Updated dependencies [e2e561c]
- Updated dependencies [7d9b08a]
- Updated dependencies [82f2480]
- Updated dependencies [89a6cc7]
  - @shipfox/api-auth-context@34.0.0
  - @shipfox/api-integration-spi@4.4.0
  - @shipfox/api-integration-claap-dto@34.0.0
  - @shipfox/node-postgres@0.6.0
  - @shipfox/node-fastify@0.5.0
  - @shipfox/node-drizzle@0.3.7
