---
"@shipfox/workflow-templates": patch
---

The ClickUp variant of `ticket-to-pr` checks that a change record has `after` before it reads it, so a ClickUp event without `after` no longer fails the trigger filter.
