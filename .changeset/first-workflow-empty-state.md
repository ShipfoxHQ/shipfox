---
"@shipfox/client-shell": minor
"@shipfox/client-workflows": minor
"@shipfox/client-onboarding": minor
"@shipfox/client-features": minor
---

The project workflows page shows the first workflow panel when the project has no workflow.

- **`@shipfox/client-shell`:** `ChromeSlots` gains an optional `FirstWorkflowPanel` slot that receives `projectId`.
- **`@shipfox/client-workflows`:** `ProjectWorkflowsPage` renders the slot in place of the empty definitions list once definitions have loaded, the project has none, and sync is neither pending nor running. Without the slot, the page keeps its empty list. A sync that failed only because the repository has no workflow files no longer shows the "Workflow sync failed" callout; the empty state already says so.
- **`@shipfox/client-onboarding`:** exports `ProjectFirstWorkflowPanel`, also from `/feature` as a lazy component. It reads the progress of that project only, so a definition or a test run in another project never changes it, and it ignores the checklist's dismissal. It shows a skeleton while that progress loads and choose mode if the read fails. Once the project has a definition, it renders nothing and refreshes the project's definitions list.
- **`@shipfox/client-features`:** the default project workflows page shows the first workflow panel when the project has no workflow.
