---
"@shipfox/workflow-document": minor
---

The job `container` field is now accepted by default. `parseWorkflowDocument` accepts it unless called with `{jobContainers: false}`, and `buildWorkflowJsonSchema` includes it unless called with `{containers: false}`. Both options defaulted to `false` before.
