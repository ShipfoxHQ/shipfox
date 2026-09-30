---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": patch
---

`checkRunReadiness` now reports `secret-missing` for a step secret that is defined at neither workspace nor project scope. It fails the job after the run starts, and never refuses the start. Each definition also lists the `secrets.inputs.*` it reads, so a trigger can compare them with its secret mappings.
