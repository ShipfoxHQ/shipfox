---
"@shipfox/client-onboarding": major
---

The workspace home now shows one onboarding panel at a time. A new workspace sees the tools step first: a provider grid on the home, with "Skip for now" or "Continue". The first-workflow panel shows only after that button is pressed, and the home waits for the first-workflow read before it renders anything. A workspace that skipped the tools step, or that already has a test run or a workflow, no longer counts the tools row toward completion.

Breaking: `WorkspaceSetupChecklist` no longer takes a `companion` node. `deriveSetupChecklist` requires `toolsStepFinished` and accepts an undefined `firstWorkflow`. The compact panel toggle reads "Show all steps". The panel captures `onboarding_tools_step_finished` with `outcome` and `connected_count`.
