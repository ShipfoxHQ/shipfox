---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-runners": minor
"@shipfox/api-runners-dto": minor
---

Adds per-step runner execution: the runner pulls and reports steps over the lease-token-authed step API (minted at job claim), step reports carry exit codes, and job completion is signalled through the workflows outbox instead of a single atomic job report.
