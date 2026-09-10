---
"@shipfox/client-shell": major
"@shipfox/client-usage": patch
"@shipfox/client-workflows": patch
---

UsagePricingReference values now require an opaque workspaceId, and map/record resolveCosts results must be re-keyed with usagePricingReferenceKey or return entries carrying a matching workspaceId/reference.
