---
"@shipfox/api-integration-jam": minor
"@shipfox/api-integration-jam-dto": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-server": patch
"@shipfox/actions": minor
---

Add the Jam integration. An admin connects a Jam workspace by pasting a personal access token, and agent steps and tool steps can then read a Jam bug report: its details, console logs, network requests, user events, metadata, transcript and chapters, and search Jams. Agent steps can also read screenshots and video frames as images. The connection is read-only, takes a Jam ID or a `jam.dev` link, and can have its token replaced without recreating it. The generated action tool types include the Jam tools.
