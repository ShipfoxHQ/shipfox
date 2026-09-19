---
"@shipfox/workflow-document": minor
"@shipfox/api-definitions": minor
---

Adds top-level workflow `concurrency` with required `group`. `scope` defaults to `workflow`, and `cancel_in_progress` defaults to `false`. Definitions warns when group roots may be unavailable and rejects unsupported policies.
