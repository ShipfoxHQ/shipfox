---
"@shipfox/api-definitions-dto": patch
---

Removes the unused workflow-spec, job, and step schemas now that `@shipfox/workflow-document` owns workflow document parsing, keeping only the still-used `TriggerDto` type.
