# Shipfox API Registry

`@shipfox/api-registry` fetches, verifies, and caches versions from a Shipfox Registry for the API.

## What it does

- **`createRegistryModule`**: Declares the `registry` module: its database, its inter-module presentation, and a startup task that purges cached rows of other registries.
- **`resolveVersion`**: Returns a version whose signed document verifies under the instance's trusted keys, with its content bundle. A stored version is verified again on every read. When the check fails, the row is deleted and the version is fetched again.
- **`getSource` and `getReadme`**: Return the source archive and the README of a version. Both are fetched on first use, checked against the signed digests, and stored.

## Installation and setup

The API composition root registers the module in `libs/api/server/src/modules.ts`. Set `REGISTRY_URL` and `REGISTRY_TRUSTED_KEYS` to enable it.

```sh
pnpm add @shipfox/api-registry
```

## Usage

Other modules call the module through the `@shipfox/api-registry-dto/inter-module` contract, never through this package.

```ts
import {createRegistryModule} from '@shipfox/api-registry';
import {initializeModules} from '@shipfox/node-module';

await initializeModules({modules: [createRegistryModule()]});
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `REGISTRY_URL` | empty | URL of the registry API. Empty disables the module: every call fails with `registry-disabled`. |
| `REGISTRY_TRUSTED_KEYS` | `[]` | JSON list of `{keyid, public_key}`. A public key is a base64 DER Ed25519 key. Required when `REGISTRY_URL` is set. |

Startup fails when `REGISTRY_URL` is not an HTTP or HTTPS URL, when `REGISTRY_TRUSTED_KEYS` is invalid, or when a URL is set without a key. The URL is normalized: the query, fragment, credentials, and trailing slashes are dropped.

## Data model

This module owns tables with the `registry_` prefix.

| Table | Purpose |
| --- | --- |
| `registry_versions` | Stores each verified version by `(registry, package, version)`: the envelope as fetched, the verified document, the gzip content bundle, and, once fetched, the source archive and README. |

Rows are global across workspaces, because registry content is identical for all workspaces. A row is never updated, except to fill the source or README the first time they are read.

## Behavior notes

- **Trust root:** Only the keys in `REGISTRY_TRUSTED_KEYS` decide what is trusted. Removing a key takes effect on the next read, without a cache reset.
- **Verification:** A version is accepted when one signature verifies under a trusted key, the signed document names the requested package, version, and kind, and the content matches the signed digest. A valid envelope of another version cannot be substituted.
- **Registry switch:** Reads only use rows of the configured registry. At startup, the module deletes rows of any other registry.
- **Errors:** A missing envelope is `registry-version-not-found`. A network failure, a timeout, a non-404 error status, or a missing blob is `registry-unavailable`. A failed signature, a document that names another version or kind, and a digest mismatch are `registry-signature-invalid`. An unknown document schema is `registry-schema-unsupported`.
- **Cache hits and outages:** A stored version is served with no network call, so it keeps working while the registry is down.

## Development

```sh
turbo check --filter=@shipfox/api-registry
turbo type --filter=@shipfox/api-registry
turbo test --filter=@shipfox/api-registry
```

Tests need the repository's local Postgres. They serve a signed registry from a local HTTP server, so they run the real verification path.

## License

MIT
