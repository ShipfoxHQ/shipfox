---
"@shipfox/expression": minor
"@shipfox/api-definitions": patch
---

Reject workflow definitions whose step run/env/agent/name interpolation references a context root not yet available at that field's fill site, with a message naming when the root becomes available.
