# Shipfox Registry format

The file formats of the Shipfox Registry, shared by the registry service, its
release tool, Shipfox instances, and the docs build.

## What it does

- **References** parse, compare, and format `namespace/name@MAJOR.MINOR.PATCH`.
  Namespaces and names use the workspace slug grammar: lowercase letters,
  digits, and single hyphens, 2 to 40 characters. Versions are exact, with no
  ranges, tags, pre-release, or build metadata. `parseRegistryReference`,
  `parseRegistryPackageName`, and `parseRegistryVersion` return `undefined` on
  anything else. Matching Zod schemas are exported.
- **Document schemas** validate every registry file: the version document
  (`registryVersionDocumentSchema`, for actions and templates), the package
  index, the catalog and its entries, the namespace profile, and the
  `.well-known` metadata.
- **Storage layout** helpers return the object key of each file, such as
  `registryVersionPath` and `registryBlobPath`. They throw on a segment outside
  the grammar, so a crafted name can never reach another prefix.
- **`computeFingerprint(document)`** identifies a publication by its content.
  It hashes the canonical JSON of the package, kind, version, license, blob
  digests, manifest, changelog, dependencies, actions, and builder recipe.
  `published_at`, `provenance`, and the builder's tool version are excluded,
  so a retried publish of the same content keeps its fingerprint.
- **`canonicalJson(value)`** writes JSON with object keys sorted at every depth.

The package is browser-safe: hashing uses WebCrypto.

## Installation and setup

```bash
pnpm add @shipfox/registry-format
```

## Usage

```ts
import {
  compareRegistryVersions,
  formatRegistryPackageName,
  parseRegistryReference,
  registryVersionPath,
} from '@shipfox/registry-format';

const reference = parseRegistryReference('shipfox/slack-thread-digest@1.4.2');
if (reference) {
  const key = registryVersionPath({
    package: formatRegistryPackageName(reference),
    version: reference.version,
  });
  // v1/packages/shipfox/slack-thread-digest/versions/1.4.2.json
}

['1.10.0', '1.2.0'].sort(compareRegistryVersions); // ['1.2.0', '1.10.0']
```

## Behavior notes

- Index, catalog, and profile files are unsigned and mutable. Only version
  documents are signed, and only they decide what runs.
- The `.well-known` metadata is informational. Instances trust the keys in
  their own configuration, never the keys it lists.
- A version document's `bump` is absent on a package's first version.

## Development

```sh
turbo check --filter=@shipfox/registry-format
turbo type --filter=@shipfox/registry-format
turbo test --filter=@shipfox/registry-format
```

## License

MIT
