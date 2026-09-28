---
"@shipfox/api-workflows": patch
---

Run creation freezes the tool grants of action steps. Each integration alias resolves to its connection and to the concrete tools its selectors match, with methods, sensitivity, and result kind. The grants are stored with the run attempt, so reruns reuse them and a tool added to the catalog later does not widen them. An action step's config lists the granted tools of each alias. An unavailable or mismatched connection fails run creation.
