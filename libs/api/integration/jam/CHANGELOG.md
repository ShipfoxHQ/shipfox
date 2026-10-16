# @shipfox/api-integration-jam

## 34.0.0

### Minor Changes

- 2b3aded: Adds `GET /integrations/jam/connections/:connectionId`, which returns the Jam user a connection acts as and the last four characters of its token.
- f769d90: Add the Jam integration. An admin connects a Jam workspace by pasting a personal access token, and agent steps and tool steps can then read a Jam bug report: its details, console logs, network requests, user events, metadata, transcript and chapters, and search Jams. Agent steps can also read screenshots and video frames as images. The connection is read-only, takes a Jam ID or a `jam.dev` link, and can have its token replaced without recreating it. The generated action tool types include the Jam tools.

### Patch Changes

- Updated dependencies [16d18f4]
- Updated dependencies [c4f486b]
- Updated dependencies [2d009f4]
- Updated dependencies [c06262b]
- Updated dependencies [f769d90]
- Updated dependencies [2b3aded]
- Updated dependencies [f769d90]
- Updated dependencies [c8e0869]
- Updated dependencies [21c993b]
- Updated dependencies [1d94e37]
- Updated dependencies [e2e561c]
- Updated dependencies [7d9b08a]
- Updated dependencies [82f2480]
- Updated dependencies [89a6cc7]
  - @shipfox/api-auth-context@34.0.0
  - @shipfox/api-integration-spi@4.4.0
  - @shipfox/node-postgres@0.6.0
  - @shipfox/node-fastify@0.5.0
  - @shipfox/api-integration-jam-dto@34.0.0
  - @shipfox/node-drizzle@0.3.7
