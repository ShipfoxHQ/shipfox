---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": patch
---

Adds the `checkRunReadiness` inter-module operation, which reports the variables a workflow reads that are not defined at workspace or project scope. Each `variable-missing` issue says whether it blocks the run from starting or fails a job after the run starts, and where the variable is read.
