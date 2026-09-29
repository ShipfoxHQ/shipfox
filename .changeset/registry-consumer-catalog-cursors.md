---
"@shipfox/api-registry": patch
---

`getCatalog` follows the registry's `next_cursor` and returns every page of the catalog, so a catalog past 100 packages is no longer cut off.
