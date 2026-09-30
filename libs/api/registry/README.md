# Shipfox API Registry

`@shipfox/api-registry` fetches, verifies, and caches versions from a Shipfox Registry for the API.

## What it does

- **`createRegistryModule`**: Declares the `registry` module: its database, its inter-module presentation, and a startup task that purges cached rows of other registries.
- **`resolveVersion`**: Returns a version whose signed document verifies under the instance's trusted keys, with its content bundle. A stored version is verified again on every read. When the check fails, the row is deleted and the version is fetched again.
- **`getSource` and `getReadme`**: Return the source archive and the README of a version. Both are fetched on first use, checked against the signed digests, and stored.
- **`getCatalog` and `getPackageIndex`**: Return the registry catalog and the index of one package. Both are stored, and a stale copy is refreshed in the background.

## Installation and setup

The API composition root registers the module in `libs/api/server/src/modules.ts`. It reads the central Shipfox Registry by default. Set `REGISTRY_URL` and `REGISTRY_TRUSTED_KEYS` to use another registry, or set `REGISTRY_URL` to an empty value to disable it.

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
| `REGISTRY_URL` | `https://api.registry.shipfox.io` | URL of the registry API. The default is the central Shipfox Registry. An empty value disables the module: every call fails with `registry-disabled`. |
| `REGISTRY_TRUSTED_KEYS` | the production key `reg-2026-1` | JSON list of `{keyid, public_key}`. A public key is a base64 DER Ed25519 key. The default trusts the central Shipfox Registry. Required when `REGISTRY_URL` is set, so set it to a key of your own registry when you change the URL. |
| `REGISTRY_CATALOG_REFRESH_SECONDS` | `900` | Seconds a stored catalog or package index is served before the next read refreshes it in the background. |

Startup fails when `REGISTRY_CATALOG_REFRESH_SECONDS` is negative, when `REGISTRY_URL` is not an HTTP or HTTPS URL, when `REGISTRY_TRUSTED_KEYS` is invalid, or when a URL is set without a key. The URL is normalized: the query, fragment, credentials, and trailing slashes are dropped.

## Data model

This module owns tables with the `registry_` prefix.

| Table | Purpose |
| --- | --- |
| `registry_indexes` | Stores the last good catalog and package index by `(registry, key)`, where `key` is `catalog` or a package name: the body, the `ETag`, and the fetch time. |
| `registry_versions` | Stores each verified version by `(registry, package, version)`: the envelope as fetched, the verified document, the gzip content bundle, and, once fetched, the source archive and README. |

Rows are global across workspaces, because registry content is identical for all workspaces. A `registry_versions` row is never updated, except to fill the source or README the first time they are read. A `registry_indexes` row is replaced whenever a refresh brings a new body, and its fetch time is renewed when the registry answers 304.

## Behavior notes

- **Trust root:** Only the keys in `REGISTRY_TRUSTED_KEYS` decide what is trusted. Removing a key takes effect on the next read, without a cache reset.
- **Verification:** A version is accepted when one signature verifies under a trusted key, the signed document names the requested package, version, and kind, and the content matches the signed digest. A valid envelope of another version cannot be substituted.
- **Registry switch:** Reads only use rows of the configured registry. At startup, the module deletes rows of any other registry.
- **Errors:** A missing envelope is `registry-version-not-found`. A network failure, a timeout, a non-404 error status, or a missing blob is `registry-unavailable`. A failed signature, a document that names another version or kind, and a digest mismatch are `registry-signature-invalid`. An unknown document schema is `registry-schema-unsupported`.
- **Cache hits and outages:** A stored version is served with no network call, so it keeps working while the registry is down.
- **Indexes:** The catalog and package indexes are unsigned and mutable. The first read fetches and stores them. A later read serves the stored copy, and when it is older than `REGISTRY_CATALOG_REFRESH_SECONDS`, it also starts one background refresh with `If-None-Match`. A `304` renews the copy, a new body replaces it, and a failed refresh keeps the last good copy, so a restart during a registry outage still lists packages. A missing first copy while the registry is down is `registry-unavailable`. A package the registry no longer knows is dropped from the store, and `getPackageIndex` returns `undefined` for it.
- **Catalog pages:** `getCatalog` follows `next_cursor` until the last page and stores the merged catalog. A refresh that fails on any page keeps the last good copy. Only the first page is revalidated with `If-None-Match`.

## Development

```sh
turbo check --filter=@shipfox/api-registry
turbo type --filter=@shipfox/api-registry
turbo test --filter=@shipfox/api-registry
```

Tests need the repository's local Postgres. They serve a signed registry from a local HTTP server, so they run the real verification path.

## License

MIT
