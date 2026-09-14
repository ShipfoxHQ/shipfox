---
"@shipfox/api-workflows": patch
---

Gate workflow run scheduling on a durable concurrency claim and start run timeouts after acquisition.

Rollout constraint: Do not roll back workflow workers past `workflow-run-concurrency-gate` while post-deploy histories are active. Drain or reset those histories before rollback. Retain the patch marker until a Temporal `deprecatePatch` cycle.
