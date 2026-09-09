---
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
---

Workflow models expose `group`, `scope`, and `cancelInProgress` concurrency fields.
Definitions warn when groups reference contexts unavailable to declared triggers.
Snapshots containing concurrency use version 4. Versions 2 and 3 remain readable.
Earlier readers reject version 4 snapshots. Upgrade every reader before writing concurrency-bearing snapshots.
