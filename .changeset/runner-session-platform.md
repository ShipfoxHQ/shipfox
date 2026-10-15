---
"@shipfox/api-runners-dto": minor
"@shipfox/api-runners": minor
---

Runners report their operating system and architecture at registration through a required `platform` field, and the Runners module stores it on the runner session. Adds the `getRunnerSessionPlatform` inter-module read.
