# Package release tooling

`verify-generated-release` checks whether a pull request is exactly the output
of `pnpm exec changeset version` from its declared base revision.

The release App identity and `changeset-release/main` branch are required
signals, but they are not a security boundary. An attacker can reproduce a
branch name or create a pull request with similar metadata. The verifier creates
an isolated checkout at the base revision, regenerates the version change, and
compares the complete Git tree with the submitted head revision. Any extra or
changed file, including a package manifest field, makes the result
`not-generated-release`.

The command prints exactly one JSON result to standard output:

```sh
pnpm --filter=@shipfox/package-release verify-generated-release -- \
  --base "$BASE_SHA" \
  --head "$HEAD_SHA" \
  --repository "$GITHUB_REPOSITORY" \
  --head-repository "$HEAD_REPOSITORY" \
  --head-ref "$HEAD_REF" \
  --author-id "$PULL_REQUEST_AUTHOR_ID" \
  --release-app-id "$RELEASE_BOT_APP_ID"
```

`classification` is either `generated-release` or `not-generated-release`.
CI must use only `generated-release` to select a release-specific path.

`pnpm run release:preflight` builds the public libraries and tools, stages every
package in `publication-closure.json` plus every public tool, and packs each one
without registry credentials. It validates productionized manifests, runtime
dependency references, and packed entry-point files. Staging directories and
tarballs live under the system temporary directory, so the source tree is not
rewritten.

Preflight proves that the planned packages can be transformed and packed as a
coherent release closure. The real publish step still proves registry
authorization, provenance, and that npm accepted each upload.

When `SHIPFOX_PUBLISHED_VERSIONS_PATH` is set, the closure publisher writes the
exact versions that `changeset publish` uploaded to that JSON file. It reads
them from the local `<name>@<version>` Git tags that Changesets creates for each
accepted upload. `await-published-versions` reads the same file and polls npm
until each version appears in the install metadata and its tarball responds.
It fails after 15 minutes and lists every version that is still unavailable.
It never publishes again.

```sh
SHIPFOX_PUBLISHED_VERSIONS_PATH="$RUNNER_TEMP/published-versions.json" \
  pnpm --silent --filter=@shipfox/package-release await-published-versions
```

The file holds `{"packages": [{"name": "...", "version": "..."}]}`, sorted by
name. It lists only the versions this run published, and the list is empty
when the run published nothing. After npm serves every version, the publish
workflow uploads the file as the `published-versions` artifact for 30 days.
Downstream refreshes can read it with
`gh run download <run-id> -R ShipfoxHQ/shipfox -n published-versions`.

## Candidate bundles

Every `main` commit whose CI passes in normal mode publishes a candidate bundle.
Version-only commits don't. Cloud's staging-edge workflow installs the bundle
through pnpm overrides. Nothing in this path publishes to npm.

`pack:candidate` productionizes the same manifests as `release:publish`, runs
`pnpm pack` for each package, and restores the source manifests. It keeps each
package's `version`. Before packing, it resolves `workspace:` and `catalog:`
references the way preflight does. pnpm resolves the same values, but in an
unstable order, so without this step a repacked commit wouldn't match its
uploaded tarballs. Build the closure first:

```sh
turbo type build type:emit --filter='./libs/**' --filter='./tools/**'
pnpm --filter=@shipfox/package-release pack:candidate -- \
  --sha "$(git rev-parse HEAD)" \
  --output .context/candidate \
  --public-url https://candidates.shipfox.io
```

The output folder holds every tarball, plus these two files:

- `manifest.json`: `schemaVersion`, `sha`, `createdAt`, `ciRun`, and
  `packages` sorted by name. Each package lists its `name`, `version`, tarball
  `file`, and `integrity`. The integrity is the `sha512-` hash that pnpm records
  in a consumer's lockfile.
- `overrides.yaml`: an `overrides:` map from each package name to its tarball
  URL, ready to merge into Cloud's `pnpm-workspace.yaml`.

`upload:candidate` writes the folder to `candidates/<sha>/` in the
`shipfox-package-candidates` R2 bucket. It sends each object with
`If-None-Match: *`, so it never overwrites one. Tarballs go first, then
`overrides.yaml`, then `manifest.json`, so a present manifest means a complete
folder. A rerun succeeds when the existing objects match. A tarball or
`overrides.yaml` must match byte for byte. A manifest must list the same
packages. Any other conflict fails the upload.

Then the upload rewrites `candidates/main.json` as `{"sha", "createdAt"}`. It
skips this when the pointer already names a newer commit, for example when
someone reruns the job for an older commit. The CI job notifies Cloud only when the pointer
moved. It sends a `repository_dispatch` of type `shipfox-candidate-published`
to `ShipfoxHQ/cloud`, with `client_payload: {sha, manifestUrl}`.

The CI job reads these settings:

- `R2_CANDIDATE_ACCESS_KEY_ID` and `R2_CANDIDATE_SECRET_ACCESS_KEY` secrets: the
  bucket-scoped R2 token. Cloud's candidate storage runbook covers rotation.
- `CLOUDFLARE_ACCOUNT_ID` variable: builds the R2 S3 endpoint.
- The release App (`RELEASE_BOT_CLIENT_ID`, `RELEASE_BOT_APP_PRIVATE_KEY`)
  mints the dispatch token. Its installation must include `ShipfoxHQ/cloud`
  with **Contents: write**, which GitHub requires for `repository_dispatch`.
