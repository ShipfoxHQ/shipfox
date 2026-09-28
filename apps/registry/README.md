# @shipfox/registry

Runs the Shipfox Registry service: it stores registry files, serves them, and
owns the bootstrap file that declares namespaces and curation.

## What it does

- **Storage** keeps every registry file in one bucket or directory, under the
  layout from [`@shipfox/registry-format`](../../libs/shared/registry/format).
  Drivers: `s3://` (S3, R2, MinIO) and `file://` (development and E2E). Both
  support create-only writes (`If-None-Match: *`) and compare-and-swap writes
  (`If-Match: <etag>`).
- **Reads** serve the public `v1/` and `.well-known/` files as stored, with
  `ETag` and `If-None-Match` support. Version documents and blobs are marked
  immutable; indexes use `no-cache`. `_registry/` is never served.
- **Bootstrap** loads the bootstrap file at startup and refuses to start when it
  is missing or invalid. It then rewrites `.well-known/shipfox-registry.json`,
  every namespace profile, and the catalog's publishers and `featured` order.
- **`reindex`** rebuilds every package index and the catalog from the stored
  version documents.

## Installation and setup

The app is private and runs from this repository or its image. For local
development, `apps/registry/.env` points at `bootstrap.example.yaml`, a
development signing key, and a file store under `/tmp/shipfox-registry-dev`.

```sh
mise exec -- pnpm --filter @shipfox/registry dev
```

## Usage

Read the catalog and a namespace profile from a running registry:

```sh
curl http://localhost:16120/v1/index.json
curl http://localhost:16120/v1/namespaces/shipfox.json
```

Rebuild all indexes, from the registry container or a checkout:

```sh
node dist/cli.js reindex                                # in the image
mise exec -- pnpm --filter @shipfox/registry reindex    # in a checkout
```

The command exits with 1 when it cannot read a version document. It logs each
skipped file and leaves it out of every index.

## Environment

`src/config.ts` owns the variables and their descriptions. An `s3://` store
reads its endpoint, region, and credentials from the shared
`OBJECT_STORAGE_S3_*` settings of
[`@shipfox/node-object-storage`](../../libs/shared/node/object-storage). The
bucket and prefix come from `REGISTRY_STORAGE_URL`. The store must support
conditional writes, as S3, R2, and MinIO do.

### Bootstrap file

`REGISTRY_BOOTSTRAP_PATH` names a YAML file. It is the only authority over
namespaces, profiles, publishers, and curation. Operators change it and
redeploy.

```yaml
issuer: https://api.shipfox.io          # optional
reserved: [shipfox-*, github, admin]    # slugs, or a prefix ending in *
featured: [shipfox/ticket-to-pr]        # catalog order; namespaces must be declared
namespaces:
  shipfox:
    status: active                      # active | suspended; defaults to active
    profile: {display_name: Shipfox, url: https://www.shipfox.io, verified: true}
    owner: {workspace_id: 3f0c8f6e-0000-4000-8000-000000000000}  # optional
    publishers:
      - provider: github
        repository_id: "812345678"      # numeric ids, as strings
        repository_owner_id: "1234567"
        repository: ShipfoxHQ/shipfox   # display only
        workflow: .github/workflows/publish-packages.yml
        environment: registry           # optional
        ref: [refs/heads/main]          # optional
        runner_environment: github-hosted  # default; or self-hosted
```

Unknown fields are errors, so a typo refuses startup.

## Behavior notes

- The file store makes conditional writes atomic within one process. Run a
  single registry process per directory.
- Indexes, the catalog, and profiles are unsigned. The registry updates the
  catalog and indexes with `If-Match` and a bounded retry, so concurrent
  writers do not lose entries.
- `.well-known/shipfox-registry.json` lists the signing key's public key as
  base64 of its 32 raw bytes. It is informational: instances trust only their
  configured keys.
- A namespace removed from the bootstrap file keeps its profile file. Its
  catalog entries lose `verified` and fall back to the namespace as display
  name.

## Development

```sh
turbo check --filter=@shipfox/registry
turbo type --filter=@shipfox/registry
turbo test --filter=@shipfox/registry
```

## License

MIT
