# @shipfox/docker

## 0.1.0

### Minor Changes

- 8b53185: Derive the per-commit tag set from the environment with a new `--image <name>` flag, so one `turbo image --filter …` tags every app. The workflow supplies the ref — registry bases as a space-separated `IMAGE_REGISTRIES` list (e.g. `ghcr.io/shipfoxhq`) and the commit identity as `GITHUB_SHA` / `BUILD_NUMBER` / `GITHUB_REF_NAME` — and the package script passes the image name; for each registry base `shipfox-docker` emits `<base>/<name>:sha-<short>`, `:build-<number>`, and a moving branch tag (`:latest` on the default branch `main`, the sanitized branch name otherwise). With `IMAGE_REGISTRIES` unset (the PR validation path) it builds single-arch `--platform linux/amd64 --load` and emits a single local `<name>:ci` tag instead of pushing a multi-arch index. The `IMAGE_REVISION` (from `GITHUB_SHA`) and `IMAGE_CREATED` OCI build-args are set by the tool from the environment rather than passed as `turbo image -- …` args, since args after `--` enter every task's hash and would bust the workspace build cache. An explicit `--tag`, `--platform`, `--push`/`--load`, or `--build-arg` still takes precedence.
- 4d1bef8: Add the `@shipfox/docker` tool exposing a `shipfox-docker` CLI that wraps `docker buildx`. It prepares the build context with `--setup-context` (turbo prune plus an overlay of each pruned package's prebuilt `dist/`, the "build outside Docker, ingest dist" approach) and runs a single multi-platform build that pushes a multi-arch image to multiple registries in one pass. It defaults `--platform`, `--push`, and the gha BuildKit cache only when the caller did not set them, so a PR can still build single-arch without pushing.

### Patch Changes

- 8fc5b80: Point each pruned package's `#*` subpath imports at the built `dist/` when preparing a node app's build context. The image runs the prebuilt `dist/` with plain `node`, so `import '#core/run.js'` must resolve to `./dist/core/run.js`; the unconditional `./src/*` the source uses would resolve to a TypeScript file the image does not ship. A `development` condition keeps `tsx` on `src/`, so only the pruned context's runtime resolution changes.
