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
