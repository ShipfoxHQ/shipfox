---
"@shipfox/api-workflows": patch
---

Re-run failed jobs now also re-runs every succeeded job that depends on a re-run job, instead of reusing it.
