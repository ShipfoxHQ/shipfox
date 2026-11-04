---
"@shipfox/api-integration-linear": patch
"@shipfox/workflow-templates": patch
---

A late run result reaches a Linear session even when Linear refuses the activity, and Shippy tells people a settled run keeps handling review feedback.

- **Linear:** when Linear refuses a `response` or `error` activity, the reply becomes a comment on the session's issue, created as the agent's name. It is undeliverable when Linear refuses the comment too, or the session has no issue.
- **Shippy:** at settled, the reply links what the run produced and says the run stays open for review feedback.
