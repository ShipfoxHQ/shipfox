---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-triggers": minor
"@shipfox/api-triggers-dto": minor
---

Stops work for a deleted project and refuses new work. After a project is deleted, its open runs and listening jobs are canceled, its active turns stop with no reply in Slack or Linear, and no trigger, cron, manual fire, dev run, or rerun can start a run in it, including a job with `checkout: false`.

- **Workflows:** every start path checks that the project is live before it creates a run. A refused start fails with the new `project-deleted` error on `startRunFromTrigger`, `startDevRun`, `rerunWorkflowRun`, and `deliverEventToJobListener`. `runWorkflow`, `runDevWorkflow`, and `rerunWorkflowRun` now require a `projects` client. The module adds `stopWork({scope, reason})`, a core function and an inter-module method that cancels the open runs in a workspace or project and returns how many remain. Its `PROJECT_DELETED` subscriber calls it. The run keeps the existing canceled status, with no deletion reason yet.
- **Agent:** turn admission refuses a deleted project quietly, and the pinned prompt no longer falls back to an `unknown` project name. The module adds the same `stopWork` method. With `project_deleted` it marks the replies of the stopped turns `suppressed`, so nothing is posted back and the loading status is left alone. Its `PROJECT_DELETED` subscriber calls it.
- **Triggers:** a `project-deleted` error from Workflows shows as the `project-deleted` decision diagnostic and as `project-not-found` on the manual-fire and dev-run routes. The command contracts list the new error.
