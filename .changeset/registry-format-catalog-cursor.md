---
"@shipfox/registry-format": minor
---

`registryCatalogSchema` accepts an optional `next_cursor`, which a registry sets on a catalog page that is followed by more entries. Pass it as the `cursor` query parameter of `REGISTRY_CATALOG_PATH` to fetch the next page.
