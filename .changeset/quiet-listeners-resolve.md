---
"@shipfox/api-workflows": patch
"@shipfox/api-workflows-dto": patch
"@shipfox/api-definitions": patch
---

Adds the listener orchestration loop for long-lived listening jobs: durable event draining, one execution per buffered event, resolution on until, listening deadline, or max executions, and a run-timeout backstop that resolves active listeners.
