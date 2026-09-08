---
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
---

Workflow models expose the concurrency fields `group`, `scope`, and `cancel_in_progress`, validate references against contexts available to declared triggers, and write new persisted snapshots as version 4; versions 2 and 3 remain readable, and older readers require an upgrade to read version 4.
