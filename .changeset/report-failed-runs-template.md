---
"@shipfox/workflow-templates": minor
---

Adds the `report-failed-runs` template. Each matching failed, synced Shipfox workflow run starts a report from its `run.completed` event and posts one Slack message with the failed jobs and steps, the step error, a log excerpt, and a next step. Options scope reports to the project or the workspace, filter workflow files, include cancelled runs, and add an agent diagnosis in the report's thread.
