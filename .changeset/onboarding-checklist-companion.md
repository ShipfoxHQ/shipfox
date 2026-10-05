---
"@shipfox/client-onboarding": minor
---

Adds a `companion` prop to `WorkspaceSetupChecklist`. The host renders the node below the Get started panel only while the panel renders, so a consumer can attach a card that never shows alone after dismissal, for a checklist that was complete on load, or while the checklist loads. The package also exports `WorkspaceSetupChecklistProps`.
