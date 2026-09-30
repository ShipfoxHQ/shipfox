---
"@shipfox/workflow-templates": patch
---

Fixes the Jira variant of `ticket-to-pr` so it moves a ticket to in progress. The workflow passed the transition ID as a number, which the Jira tool rejected, so the run failed before the agent started.
