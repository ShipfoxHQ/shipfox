---
"@shipfox/client-shell": major
"@shipfox/client-usage": patch
"@shipfox/client-workflows": patch
---

UsagePricingReference values now require an opaque workspaceId; map/record resolveCosts results must be keyed with usagePricingReferenceKey, and array entries must carry the full matching reference: workspaceId, kind, id, and any model/upstream identity.
