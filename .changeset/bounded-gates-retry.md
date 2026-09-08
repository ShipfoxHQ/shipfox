---
"@shipfox/workflow-document": minor
"@shipfox/api-workflows": patch
---

Workflows honors materialized gate limits from 1 through 1,000 with WORKFLOW_GATE_MAX_ATTEMPTS_MAX and preserves the three-attempt behavior when the limit is absent.
