---
"@shipfox/api-workflows": patch
---

Fixes false oversized errors for CEL integer tool outputs. Tool mappings now reject non-finite values, unsafe integers, unsupported objects, cycles, and excessive nesting.
