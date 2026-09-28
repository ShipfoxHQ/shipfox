---
"@shipfox/client-shell": minor
"@shipfox/client-workflows": minor
"@shipfox/client-onboarding": minor
"@shipfox/client-features": minor
---

The project workflows page shows the first workflow panel when the project has no workflow.

- **`@shipfox/client-shell`:** `ChromeSlots` gains an optional `FirstWorkflowPanel` slot that receives `projectId`.
- **`@shipfox/client-workflows`:** `ProjectWorkflowsPage` renders the slot under the empty state once definitions have loaded, the project has none, and sync is neither pending nor running. Without the slot, the page is unchanged.
- **`@shipfox/client-onboarding`:** exports `ProjectFirstWorkflowPanel`, also from `/feature` as a lazy component. It reads the progress of that project only, so a definition or a test run in another project never changes it, and it ignores the checklist's dismissal.
- **`@shipfox/client-features`:** the default chrome wires `ProjectFirstWorkflowPanel` into the slot.
