---
"@shipfox/api-usage-dto": major
"@shipfox/api-usage": major
"@shipfox/client-shell": major
"@shipfox/client-usage": major
"@shipfox/client-workflows": patch
---

Removes the `upstream` provider field, provider-reported token aggregates, and per-step attempt breakdowns from public usage surfaces. Model-scoped pricing reference keys now encode `[model]` instead of `[model, upstream]`.
