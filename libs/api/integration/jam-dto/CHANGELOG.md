# @shipfox/api-integration-jam-dto

## 34.0.0

### Minor Changes

- 2b3aded: Adds `GET /integrations/jam/connections/:connectionId`, which returns the Jam user a connection acts as and the last four characters of its token.
- f769d90: Add the Jam integration. An admin connects a Jam workspace by pasting a personal access token, and agent steps and tool steps can then read a Jam bug report: its details, console logs, network requests, user events, metadata, transcript and chapters, and search Jams. Agent steps can also read screenshots and video frames as images. The connection is read-only, takes a Jam ID or a `jam.dev` link, and can have its token replaced without recreating it. The generated action tool types include the Jam tools.

### Patch Changes

- Updated dependencies [c4f486b]
- Updated dependencies [4273dad]
- Updated dependencies [9e173c3]
- Updated dependencies [f769d90]
- Updated dependencies [e2e561c]
- Updated dependencies [9485c57]
- Updated dependencies [82f2480]
  - @shipfox/api-integration-core-dto@34.0.0
