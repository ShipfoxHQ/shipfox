# @shipfox/api-registry-dto

## 34.0.0

### Minor Changes

- f64bff1: Adds `getCatalog` and `getPackageIndex` to the Registry module. The catalog and each package index are served from the last good copy, so a registry outage after the first fetch keeps serving the stored data.
- 0975515: Adds the Registry module. It resolves registry package versions through an inter-module contract. It returns a version only when a trusted key signed it and its content matches the signed digest. It caches verified versions and checks them again on every read. Set `REGISTRY_URL` and `REGISTRY_TRUSTED_KEYS` to turn it on.

### Patch Changes

- Updated dependencies [a509c87]
- Updated dependencies [150d735]
- Updated dependencies [c8857f4]
- Updated dependencies [76fbfe9]
- Updated dependencies [7517867]
  - @shipfox/registry-format@0.1.0
