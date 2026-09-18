---
'@shipfox/api-workflows': patch
'@shipfox/api-workflows-dto': patch
---

Repairs drifted workflow concurrency state: releases claims left by finished runs, promotes waiting runs, cancels superseded attempts, and restarts orchestrations that never started.
