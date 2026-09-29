---
"@shipfox/registry-format": minor
---

Replaces the storage layout helpers with API path helpers. `registryVersionPath`, `registryPackagePath`, `registryNamespacePath`, `registryReadmePath`, `registryContentPath`, and `registrySourcePath` return the routes of the registry API, and `REGISTRY_METADATA_PATH` and `REGISTRY_CATALOG_PATH` name its fixed routes. `registryBlobKey` returns the key of a bundle in the private blob store. `registryBlobPath`, `registryPackageIndexPath`, `registryAuditPath`, `registryJtiPath`, and the public and private prefix constants are removed.
