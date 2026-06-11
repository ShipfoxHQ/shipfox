---
"@shipfox/api-workflows": patch
---

Extract the step-report decision into a pure `decideStepTransition` plus a durable `applyStepTransition`, creating the seam where gate evaluation and durable restart will plug in. No behavior change.
