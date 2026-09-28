---
"@shipfox/workflow-templates": minor
---

Adds the `report-failed-runs` template. Each matching failed, synced Shipfox workflow run starts a report from its `run.completed` event and posts one Slack message with the failed jobs and steps, the step error, a log excerpt, and a next step. An agent then replies in the report's thread with a diagnosis of the cause. Options scope reports to the project or the workspace and filter workflow files.
