---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
---

Adds server-side step `if:` skipping: a step whose condition evaluates false or errors is marked `skipped` (no attempt) with a reason and dispatch advances, while an execution now fails only when a step failed so an author-skipped step no longer fails the run.
