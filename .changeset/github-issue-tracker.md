---
"@shipfox/workflow-templates": minor
"@shipfox/api-agent-access": patch
---

Adds GitHub issues as a tracker for the `ticket-to-pr` template. A label or an assignee on an open issue in the project's repository starts the workflow. By default, the workflow adds an in-progress label when work starts and comments on the issue with the PR link. The PR body ends with `Fixes #<number>`, so GitHub links the PR to the issue.

`get_workflow_template` now suggests the project's source integration connection for a role on the source provider, such as GitHub issues as the tracker.
