---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
---

Adds workspace-scoped `cancelWorkflowRun` and `rerunWorkflowRun` commands: cancellation returns the run `id`, `currentAttempt`, and `status`, while rerun returns `id`, `attempt`, and `status`; both report attempt mismatches, cancellation rejects terminal runs, and rerun rejects non-terminal runs or failed-mode requests without failed jobs. `startRunFromTrigger` optionally reports `deduplicated` for an already-started run and surfaces workspace admission errors.
