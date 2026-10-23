# @shipfox/registry-format

## 0.1.0

### Minor Changes

- be33fe6: An action can declare a `post` entry in `action.yml`, which Shipfox runs at the end of the job.

  - **Manifest:** `post` follows the path rules of `main` and must differ from it. `post_failure` is `warn` (the default) or `fail`, and needs `post`. A repository action must contain the `post` file.
  - **Workflow model:** an action step carries `post` and `postFailure`. Models stored before this change omit both.
  - **SDK:** `defineAction` handlers receive `state.set(name, value)` and `state.get(name)`, backed by the `SHIPFOX_STATE` file. `context` gains `phase`, and `execution` and `main` for a post. `setOutput` throws in a post.
  - **Testing:** `runAction` accepts `phase`, `state`, `executionFailed`, and `mainStatus`, and returns the `state` after the run.
  - **Registry bumps:** `computeActionBump` returns `minor` when `post` is added or removed, `major` when `post_failure` goes from `warn` to `fail`, and `patch` from `fail` to `warn`.

- 090d6a0: Composite actions can be published to the registry.

  - **Metadata:** `deriveActionMetadata` records `kind` (`javascript` or `composite`) and marks secret inputs with `secret: true`. Versions published before have no `kind`, and are JavaScript actions.
  - **Bumps:** `computeActionBump` makes a change between a JavaScript and a composite action, or a change of an input's `secret` flag, a major bump.
  - **Nested actions:** `collectCompositeActions` lists the exact registry actions a composite action uses, for the version document's `actions`. It refuses repository paths and `${{ action.path }}/` paths. `COMPOSITE_ACTION_MAX_FILES` and `COMPOSITE_ACTION_MAX_BYTES` bound a composite bundle.
  - **Update notices:** a definition's registry references include the registry actions pinned in the repository composite actions it uses, located at the composite's `action.yml`. Pins inside registry composite actions are left out.
  - **Agent access:** `diff_registry_action` reports `kind_change` and `action_changes`, and its input changes cover `secret`. `get_registry_package` describes the composite fields it returns.

- a509c87: Adds version rules and derived metadata for actions. `computeActionBump` returns the minimum bump between two action manifests. `diffActionCapabilities` lists the changes to what an action can reach through its integration aliases. `deriveActionMetadata` returns the integrations, capabilities, interface, usage snippet, and size of an action version. An action version document's `derived` field now follows `registryActionMetadataSchema`.
- 150d735: Replaces the storage layout helpers with API path helpers. `registryVersionPath`, `registryPackagePath`, `registryNamespacePath`, `registryReadmePath`, `registryContentPath`, and `registrySourcePath` return the routes of the registry API, and `REGISTRY_METADATA_PATH` and `REGISTRY_CATALOG_PATH` name its fixed routes. `registryBlobKey` returns the key of a bundle in the private blob store. `registryBlobPath`, `registryPackageIndexPath`, `registryAuditPath`, `registryJtiPath`, and the public and private prefix constants are removed.
- c8857f4: `registryCatalogSchema` accepts an optional `next_cursor`, which a registry sets on a catalog page that is followed by more entries. Pass it as the `cursor` query parameter of `REGISTRY_CATALOG_PATH` to fetch the next page.
- 76fbfe9: Adds the Shipfox Registry format package. It parses exact package references, validates every registry file, returns the storage path of each file, and computes the publication fingerprint.
- 7517867: Adds signed envelopes for version documents. `signRegistryVersionDocument` signs a document with an Ed25519 key through a `RegistrySigner`. `verifyRegistryVersionEnvelope` accepts an envelope only when a trusted key signed it and it names the requested package, version, and kind. Verification works in Node and in browsers. Public keys must be base64 DER SubjectPublicKeyInfo Ed25519 keys.

### Patch Changes

- Updated dependencies [be33fe6]
- Updated dependencies [6b4ae32]
- Updated dependencies [7d20d04]
- Updated dependencies [dc2bd62]
- Updated dependencies [3f1363c]
- Updated dependencies [8937e15]
- Updated dependencies [d273097]
- Updated dependencies [e087b95]
- Updated dependencies [476e3b1]
- Updated dependencies [9d7c039]
- Updated dependencies [c0b814f]
- Updated dependencies [0654280]
- Updated dependencies [cfd75e4]
- Updated dependencies [f1f520f]
- Updated dependencies [cfe6ce6]
- Updated dependencies [ab66d1e]
- Updated dependencies [67e55ea]
- Updated dependencies [e08530c]
- Updated dependencies [4e3497b]
- Updated dependencies [d657853]
- Updated dependencies [cb411b1]
- Updated dependencies [9906470]
- Updated dependencies [2100749]
- Updated dependencies [f6bc1f4]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [0b661c9]
- Updated dependencies [e71cded]
  - @shipfox/workflow-document@4.0.0
