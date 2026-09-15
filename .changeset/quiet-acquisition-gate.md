---
"@shipfox/api-workflows": patch
---

Workflow runs now wait for a concurrency slot before starting; their run timeout begins only after they acquire the slot.
