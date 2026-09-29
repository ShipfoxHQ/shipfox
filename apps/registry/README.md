# @shipfox/registry

Runs the Shipfox Registry service: it keeps package metadata in its own Postgres
database and package blobs in a private store, and owns the bootstrap file that
declares namespaces and curation.

## What it does

- **Postgres** holds the metadata, in tables that start with `registry_`:
  `registry_packages`, `registry_versions`, `registry_used_tokens`, and
  `registry_audit`. The service applies its migrations at startup, under the
  history table `__drizzle_migrations_registry`.
- **Blob store** keeps only `blobs/sha256/<hex>`, the content bundles and source
  archives. A blob is written create-only with `Content-Type: application/gzip`,
  `Content-Disposition: attachment`, and
  `Cache-Control: private, max-age=31536000, immutable`. Drivers: `s3://` (S3,
  R2, MinIO, Tigris) and `file://` (development and E2E).
- **Bootstrap** loads the bootstrap file at startup into memory and refuses to
  start when it is missing or invalid. Namespaces, profiles, grants, reserved
  names, and `featured` are never stored in the database.
- **Publish token exchange** (`POST /v1/publish/token`) swaps a GitHub Actions
  OIDC token for a publish token. The token must verify, match an active
  publish grant, and not have been used before.
- **Version publishing** (`PUT /v1/packages/{namespace}/{name}/versions/{version}`)
  validates a package, signs its version document, and stores it. A publish
  token is the bearer token.

A self-hosted registry is this container, a Postgres database, and an
S3-compatible store (or a directory in development).

## Installation and setup

The app is private and runs from this repository or its image. For local
development, `apps/registry/.env` points at `bootstrap.example.yaml`, a
development signing key, and a file store under `/tmp/shipfox-registry-dev`. The
`dev` script uses the `registry` database on the local Postgres. The
repository's Postgres image creates it on a fresh volume. On an older volume,
create it once:

```sh
docker compose exec postgres psql -U shipfox -d api -c 'CREATE DATABASE registry'
mise exec -- pnpm --filter @shipfox/registry dev
```

## Usage

Exchange a GitHub Actions OIDC token for a publish token. The job requests the
OIDC token with the registry URL as its audience, exactly as written in
`REGISTRY_PUBLIC_URL`:

```sh
curl -X POST http://localhost:16120/v1/publish/token \
  -H 'content-type: application/json' \
  -d '{"oidc_token": "<token>"}'
# {"publish_token": "<jwt>", "expires_at": "2026-10-01T09:10:00.000Z"}
```

| Status | Code | Meaning |
| --- | --- | --- |
| 401 | `invalid-oidc-token` | The token failed verification, or lacks a claim the registry needs. |
| 401 | `oidc-token-replayed` | The token was already exchanged. |
| 403 | `publish-grant-not-found` | No grant matches the token. The response never says which claim differed. |
| 403 | `namespace-suspended` | The matching grant belongs to a suspended namespace. |

### Publish a version

Send a multipart request with a publish token as the bearer token. The token
names one namespace, and `{namespace}` must be that one.

| Part | Content |
| --- | --- |
| `draft` | JSON: `kind`, `license` (an SPDX expression), `builder`, `path`, `changelog` when present, and by kind `dependencies` (actions) or `composition` (templates). Unknown fields are refused. |
| `content` | The gzip content bundle: `action-bundle@1` (`action.yml`, `index.mjs`, and `LICENSE` when present) or `template-bundle@1` (`template.yaml`, `workflow.yml`, `GUIDE.md`, `parts/<role>/<provider>.yml`). |
| `source` | The gzip source archive that rebuilds the version. It holds no `node_modules` or `.npmrc`. |
| `readme` | Optional README text, UTF-8, at most 64 KiB. |

The registry derives every digest, the bump, the derived metadata, and the
provenance. Nothing in `draft` can claim them. Provenance comes from the
verified publish token, and `path` from the draft.

The request must pass these checks, in this order:

1. The token verifies and its namespace is `{namespace}` and active. The name is
   a slug that no `reserved` entry of the bootstrap file matches.
2. The parts are present once each, and `draft` matches its schema. The kind
   matches the existing package, if any.
3. Each bundle inflates within its limit (action content 4 MiB, template
   content 1 MiB, source 20 MiB, request 30 MiB) and is in canonical form. The
   manifest parses, the description or summary is 1 to 160 characters, the
   license is SPDX, and a template composes for every role binding.
4. A version that exists with the same fingerprint is a retry. With another
   fingerprint it is refused with `changed-without-version-bump`.
5. The version step from the highest lower version is at least the bump that
   `computeActionBump` or `computeTemplateBump` computes. The first version has
   no bump.
6. Every registry action a template uses exists. The list is what the
   composed workflow of any binding uses, with every option block kept.

The blobs are written first, under `blobs/sha256/<digest>`, and one transaction
then commits the package row, the version row with its envelope, and the audit
row. A crash between the two leaves blobs that no version points to. A
retry of the same request then publishes normally.

| Status | Meaning |
| --- | --- |
| 201 | Published. The body is the signed envelope. |
| 200 | Already published with the same content. The body is the stored envelope. |
| 400 | `invalid-request` or `invalid-package-name`. |
| 401 | `invalid-publish-token`. |
| 403 | `namespace-mismatch`, `namespace-suspended`, or `reserved-name`. |
| 409 | `kind-mismatch` or `changed-without-version-bump`. |
| 413 | `too-large`. |
| 422 | `invalid-draft`, `invalid-bundle`, `invalid-manifest`, `invalid-metadata`, `unsupported-composition`, `invalid-template`, `bump-too-low`, or `action-not-found`. |

Every attempt of a verified token is a row in `registry_audit`: accepted
publishes, retries, and refusals with their reason. Requests whose token fails
verification are not recorded. After a publish or a retry, the service posts
`{package, kind, version, published_at}` to each `REGISTRY_PUBLISH_HOOKS` URL.

## Environment

`src/config.ts` owns the variables and their descriptions. The database uses the
shared `POSTGRES_*` settings of
[`@shipfox/node-postgres`](../../libs/shared/node/postgres), with a database of
the registry's own. An `s3://` store reads its endpoint, region, and credentials
from the shared `OBJECT_STORAGE_S3_*` settings of
[`@shipfox/node-object-storage`](../../libs/shared/node/object-storage). The
bucket and prefix come from `REGISTRY_STORAGE_URL`. The store must support
conditional writes, as S3, R2, MinIO, and Tigris do.

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
        ref: [refs/heads/main, refs/tags/v*]  # optional
        runner_environment: github-hosted  # default; or self-hosted
```

Unknown fields are errors, so a typo refuses startup.

A grant matches a token when all of these hold:

| Field | Rule |
| --- | --- |
| `repository_id`, `repository_owner_id` | Equal to the token claims. They identify the repository, so a rename does not break the grant. |
| `workflow` | The token's `workflow_ref` starts with `<repository claim>/<workflow>@`. |
| `ref` | Optional. One entry matches the token's `ref` claim exactly. A `*` matches any characters inside one path segment. |
| `environment` | Optional. Equal to the token's `environment` claim. |
| `runner_environment` | Equal to the token claim. |

Publishers of a `suspended` namespace get no token. When several namespaces
grant the same identity, the first one in the file wins.

## Behavior notes

- The file store makes create-only writes atomic with `link()`, so several
  registry processes can share a directory.
- A blob is a gzip bundle, keyed by the digest of its canonical JSON. The store
  inflates it and checks that digest before it writes. Writing an existing key
  again with the same content succeeds, even from another gzip encoding, and
  keeps the stored bytes. It refuses to replace a key that holds other content.
- The exchange accepts RS256 tokens from `https://token.actions.githubusercontent.com`
  with an `iat` no older than 10 minutes. Every time check (`exp`, `nbf`,
  `iat`) allows 60 seconds of clock tolerance, so an `iat` up to 60 seconds
  ahead passes and a token up to 11 minutes old does too. It caches the
  issuer's key set and refetches it on an unknown key id. An unreachable
  key set fails the request with a 500, not a 401, so a job can retry.
- A publish token lasts 10 minutes, has the audience `registry-publish`, and
  names one namespace. It carries the run's provenance claims, copied from the
  verified OIDC token.
- Each exchange consumes its OIDC token id with an insert into
  `registry_used_tokens`, whose primary key lets a token work once across
  replicas. The row lives until the token can no longer verify (`exp` plus the
  60 seconds of clock tolerance). Every replica deletes expired rows every 10
  minutes.
- A refusal of a token that verified is a row in `registry_audit`, with the
  token claims and, for a missing grant, the mismatched fields of each grant.
  Tokens that fail verification are only logged, so unauthenticated requests
  cannot grow the table.

## Development

Tests use the repository's Postgres (`mise exec -- pnpm dev:services:up`). They
create and migrate a `registry_test` database when it does not exist.

```sh
turbo check --filter=@shipfox/registry
turbo type --filter=@shipfox/registry
turbo test --filter=@shipfox/registry
```

Build the image with:

```sh
mise exec -- pnpm --filter=@shipfox/registry image
```

## License

MIT
