# @shipfox/api-integration-jam-dto

## 34.0.0

### Minor Changes

- 2b3aded: Adds `GET /integrations/jam/connections/:connectionId`, which returns the Jam user a connection acts as and the last four characters of its token.
- f769d90: Add the Jam integration. An admin connects a Jam workspace by pasting a personal access token, and agent steps and tool steps can then read a Jam bug report: its details, console logs, network requests, user events, metadata, transcript and chapters, and search Jams. Agent steps can also read screenshots and video frames as images. The connection is read-only, takes a Jam ID or a `jam.dev` link, and can have its token replaced without recreating it. The generated action tool types include the Jam tools.

### Patch Changes

- Updated dependencies [2062ec8]
- Updated dependencies [0363a2c]
- Updated dependencies [1fa56a2]
- Updated dependencies [c4f486b]
- Updated dependencies [2cc76a9]
- Updated dependencies [2339c1b]
- Updated dependencies [7cc3735]
- Updated dependencies [b59424d]
- Updated dependencies [4273dad]
- Updated dependencies [9e173c3]
- Updated dependencies [b92d2a8]
- Updated dependencies [fe109f0]
- Updated dependencies [3022de6]
- Updated dependencies [f769d90]
- Updated dependencies [15b4274]
- Updated dependencies [a64d96d]
- Updated dependencies [1872f3d]
- Updated dependencies [0af8bad]
- Updated dependencies [a020cbf]
- Updated dependencies [900a25a]
- Updated dependencies [cdb88a7]
- Updated dependencies [3fe51c3]
- Updated dependencies [e6981d5]
- Updated dependencies [107ecc7]
- Updated dependencies [e2e561c]
- Updated dependencies [9485c57]
- Updated dependencies [82f2480]
  - @shipfox/api-integration-core-dto@34.0.0
