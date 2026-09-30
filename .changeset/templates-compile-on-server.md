---
"@shipfox/workflow-templates": patch
---

Fixes shipped templates that the server rejected when it created their definition. `ticket-to-pr` lets the reply step post and resolve review threads, and reads GitHub issue labels and Jira descriptions in forms the server accepts. `fix-dependency-ci` and `fix-default-branch-ci` compare event values in job outputs, because tool step outputs cannot read the event.
