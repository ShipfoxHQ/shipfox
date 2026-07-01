# @shipfox/api-definitions-dto

## 0.0.1

### Patch Changes

- 59ba68b: Integrates workflow definitions with accepted workflow documents and normalized workflow models.
- 61de795: Adds canonical runner label validation and default runner label fallback for workflow definition parsing.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- b8919da: Removes the unused workflow-spec, job, and step schemas now that `@shipfox/workflow-document` owns workflow document parsing, keeping only the still-used `TriggerDto` type.
