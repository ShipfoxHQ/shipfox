# @shipfox/registry-format

## 0.1.0

### Minor Changes

- a509c87: Adds version rules and derived metadata for actions. `computeActionBump` returns the minimum bump between two action manifests. `diffActionCapabilities` lists the changes to what an action can reach through its integration aliases. `deriveActionMetadata` returns the integrations, capabilities, interface, usage snippet, and size of an action version. An action version document's `derived` field now follows `registryActionMetadataSchema`.
- 150d735: Replaces the storage layout helpers with API path helpers. `registryVersionPath`, `registryPackagePath`, `registryNamespacePath`, `registryReadmePath`, `registryContentPath`, and `registrySourcePath` return the routes of the registry API, and `REGISTRY_METADATA_PATH` and `REGISTRY_CATALOG_PATH` name its fixed routes. `registryBlobKey` returns the key of a bundle in the private blob store. `registryBlobPath`, `registryPackageIndexPath`, `registryAuditPath`, `registryJtiPath`, and the public and private prefix constants are removed.
- c8857f4: `registryCatalogSchema` accepts an optional `next_cursor`, which a registry sets on a catalog page that is followed by more entries. Pass it as the `cursor` query parameter of `REGISTRY_CATALOG_PATH` to fetch the next page.
- 76fbfe9: Adds the Shipfox Registry format package. It parses exact package references, validates every registry file, returns the storage path of each file, and computes the publication fingerprint.
- 7517867: Adds signed envelopes for version documents. `signRegistryVersionDocument` signs a document with an Ed25519 key through a `RegistrySigner`. `verifyRegistryVersionEnvelope` accepts an envelope only when a trusted key signed it and it names the requested package, version, and kind. Verification works in Node and in browsers. Public keys must be base64 DER SubjectPublicKeyInfo Ed25519 keys.

### Patch Changes

- Updated dependencies [6b4ae32]
- Updated dependencies [d273097]
- Updated dependencies [e087b95]
- Updated dependencies [cfd75e4]
- Updated dependencies [f1f520f]
- Updated dependencies [ab66d1e]
- Updated dependencies [4e3497b]
- Updated dependencies [d657853]
- Updated dependencies [cb411b1]
- Updated dependencies [9906470]
- Updated dependencies [f6bc1f4]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [e71cded]
  - @shipfox/workflow-document@3.11.0
