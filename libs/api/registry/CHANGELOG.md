# @shipfox/api-registry

## 34.0.0

### Minor Changes

- f64bff1: Adds `getCatalog` and `getPackageIndex` to the Registry module. The catalog and each package index are served from the last good copy, so a registry outage after the first fetch keeps serving the stored data.
- 0975515: Adds the Registry module. It resolves registry package versions through an inter-module contract. It returns a version only when a trusted key signed it and its content matches the signed digest. It caches verified versions and checks them again on every read. Set `REGISTRY_URL` and `REGISTRY_TRUSTED_KEYS` to turn it on.

### Patch Changes

- 4508c5d: `getCatalog` follows the registry's `next_cursor` and returns every page of the catalog, so a catalog past 100 packages is no longer cut off.
- 59c3ea8: Reads the central Shipfox Registry by default. `REGISTRY_URL` defaults to `https://api.registry.shipfox.io` and `REGISTRY_TRUSTED_KEYS` defaults to its production signing key. Set `REGISTRY_URL` to an empty value to turn the registry off.
- Updated dependencies [6b4ae32]
- Updated dependencies [d273097]
- Updated dependencies [e087b95]
- Updated dependencies [2d009f4]
- Updated dependencies [24ea599]
- Updated dependencies [cfd75e4]
- Updated dependencies [f1f520f]
- Updated dependencies [ab66d1e]
- Updated dependencies [21c993b]
- Updated dependencies [c06262b]
- Updated dependencies [4e3497b]
- Updated dependencies [d657853]
- Updated dependencies [cb411b1]
- Updated dependencies [f64bff1]
- Updated dependencies [0975515]
- Updated dependencies [a509c87]
- Updated dependencies [150d735]
- Updated dependencies [c8857f4]
- Updated dependencies [76fbfe9]
- Updated dependencies [7517867]
- Updated dependencies [9906470]
- Updated dependencies [f6bc1f4]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [e71cded]
  - @shipfox/workflow-document@3.11.0
  - @shipfox/node-postgres@0.6.0
  - @shipfox/node-module@1.2.0
  - @shipfox/node-opentelemetry@0.7.0
  - @shipfox/api-registry-dto@34.0.0
  - @shipfox/registry-format@0.1.0
  - @shipfox/node-drizzle@0.3.7
