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
- **`computeActionBump({previous, next})`** returns the minimum bump between
  two parsed action manifests:

  | Change | Bump |
  | -- | -- |
  | Input removed, type changed, or newly required without a default | major |
  | Output removed or type changed | major |
  | Integration alias added or removed, or its provider changed | major |
  | `allow_write` turned on | major |
  | Optional input, output, or selectors added | minor |
  | Anything else, including selectors removed and `allow_write` turned off | patch |

- **`diffActionCapabilities({previous, next})`** lists what changed in the
  integration aliases: `alias_added`, `alias_removed`, `provider_changed`,
  `write_enabled`, `write_disabled`, `selectors_added`, and
  `selectors_removed`. A provider change reports only `provider_changed`.
- **`deriveActionMetadata({reference, manifest, contentBytes})`** returns the
  `derived` field of an action version document: integration providers,
  capabilities per alias, the input and output interface, a YAML usage
  snippet, and the bundle size. `registryActionMetadataSchema` validates it.
- **`canonicalJson(value)`** writes JSON with object keys sorted at every depth.
- **Signed envelopes** wrap version documents in a
  [DSSE](https://github.com/secure-systems-lab/dsse) envelope with Ed25519
  signatures.
  - `signRegistryVersionDocument` validates a document and signs its
    canonical JSON through a `RegistrySigner`. `createEd25519Signer` builds one
    from a PKCS#8 PEM private key. A KMS signer only needs to implement the
    same interface.
  - `verifyRegistryVersionEnvelope` accepts an envelope when one signature
    verifies under a trusted key with the same `keyid`. It then checks that the
    payload names the requested package, version, and kind. It throws a
    `RegistryEnvelopeError` whose `reason` is `malformed`,
    `signature-invalid`, `schema-unsupported`, or `payload-mismatch`.

The package is browser-safe: hashing, signing, and verification use WebCrypto,
and base64 uses `atob` and `btoa`. Signing and verification need WebCrypto
Ed25519 support, which current Node and browsers have.

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

Verify a fetched envelope against the keys the instance trusts:

```ts
import {verifyRegistryVersionEnvelope} from '@shipfox/registry-format';

// Throws a RegistryEnvelopeError when the envelope is not trusted.
const {document, keyid} = await verifyRegistryVersionEnvelope({
  envelope: await response.json(),
  trustedKeys: [{keyid: 'reg-2026-1', public_key: 'MCowBQYDK2VwAyEA…'}],
  expected: {package: 'shipfox/slack-thread-digest', version: '1.4.2', kind: 'action'},
});
```

## Behavior notes

- Index, catalog, and profile files are unsigned and mutable. Only version
  documents are signed, and only they decide what runs.
- The `.well-known` metadata is informational. Instances trust the keys in
  their own configuration, never the keys it lists.
- A version document's `bump` is absent on a package's first version.
- Public keys are base64 DER SubjectPublicKeyInfo: the body of the PEM that
  `openssl pkey -pubout` writes, without the armor lines.
  `registryEd25519PublicKeySchema` rejects any other format, and
  `registryTrustedKeySchema` validates one configured trusted key.
- Verification skips signatures whose `keyid` matches no trusted key. To rotate keys,
  trust the new key before the signer switches to it. Versions signed by the
  old key stay valid while it remains trusted.
- The payload type is part of the signed data, so an envelope cannot be
  replayed as another payload type.

## Development

```sh
turbo check --filter=@shipfox/registry-format
turbo type --filter=@shipfox/registry-format
turbo test --filter=@shipfox/registry-format
```

## License

MIT
