---
'@shipfox/client-onboarding': minor
'@shipfox/client-workflows': minor
---

The Get-started checklist tracks the first workflow, from a test run to the first synced definition.

- **Tracked row:** the first-workflow row now counts toward completion. It reads "Create your first workflow" and links to the workspace home. Once a dev run succeeds, it reads "A test run succeeded" and links to that run. It is done once the workspace has a definition.
- **Input:** `deriveSetupChecklist` takes a required `firstWorkflow` progress (`open`, `test_run_succeeded` with its `testRunId`, or `done`). `FirstWorkflowProgress` and `FirstWorkflowState` are exported. The quickstart action on this row is removed.
- **Refresh:** the hosts read each project's definitions and succeeded dev runs, stopping at the first definition. They reload when the window regains focus and poll every 15 seconds while the tab is visible, until the row is done. A dismissed checklist makes no request.
- **Celebration:** when the home panel sees the row turn done, it plays a burst and captures `first_workflow_activated`. If the same change completes the checklist, only the checklist completion plays. A workspace that already had a definition when the page loaded shows no burst.
- **Analytics:** `first_workflow_test_run_shown` is captured, with the host, the first time the row shows "A test run succeeded".
- **`@shipfox/client-workflows`:** exports `listWorkflowRuns`.
