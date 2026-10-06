---
"@shipfox/api-integration-posthog": patch
---

Fixes every call to the `survey-stats` tool failing with an unknown `date-time` format. The date fields keep their ISO timestamp pattern.
