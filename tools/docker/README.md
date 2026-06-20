# @shipfox/docker

Workspace wrapper around `docker buildx` for building Shipfox app images. It prepares the build context and runs a single multi-platform build, so adding a new app image is a one-file change. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **`shipfox-docker`**: Runs `docker buildx build` for the current package, with sensible defaults for a multi-arch push.
- **Context prep (`--setup-context`)**: Runs `turbo prune --docker` into an `out/` directory under the package and overlays each pruned package's prebuilt `dist/` into `out/full/`. This is the "build outside Docker, ingest `dist`" approach: the image never recompiles TypeScript, it ingests the turbo-cached build plus a real `node_modules`.
- **Per-commit tags (`--image <name>`)**: Assembles the tag set from the environment so one `turbo image --filter …` tags every app. The CI workflow supplies the _ref_ (registry bases as `IMAGE_REGISTRIES` and the commit identity as `GITHUB_SHA` / `BUILD_NUMBER` / `GITHUB_REF_NAME`) and the package script passes the image name. For each base it emits `<base>/<name>:sha-<short>`, `:build-<number>`, and `:<branch>`. With `IMAGE_REGISTRIES` unset (the PR path) it emits one local `<name>:ci` tag so a `--load` build has a reference. An explicit `--tag` you pass takes precedence and skips derivation.
- **Single multi-platform build**: Defaults to `--platform linux/amd64,linux/arm64 --push`, so one invocation emits the multi-arch manifest (no per-arch tags, no `docker manifest` step). QEMU covers both arches.
- **Clean manifest**: Defaults to `--provenance=false` so the pushed multi-arch index stays a clean per-arch manifest, without the `unknown/unknown` provenance entries some registries display. Pass your own `--provenance` to re-enable SLSA attestations.
- **gha BuildKit cache**: Adds `--cache-from`/`--cache-to type=gha` (scoped per image) when running in GitHub Actions.

The defaults are added only when you did not pass the flag yourself, so the caller stays in control. To validate a Dockerfile on a PR (single arch, no push), pass your own `--platform linux/amd64` and `--load`.

## Installation

```bash
pnpm add -D @shipfox/docker
```

> [!NOTE]
> `shipfox-docker` calls `docker buildx`, so you need the Docker CLI with Buildx. A multi-arch build also needs QEMU. In CI, `docker/setup-qemu-action` and `docker/setup-buildx-action` set both up.

## Usage

Add an `image` script to the app's `package.json`. It passes the registry image name; the workflow supplies the registries and commit identity through the environment, so the tags are assembled at build time:

```json
{
  "scripts": {
    "image": "shipfox-docker --setup-context --image api"
  }
}
```

Static apps (no `node_modules`) skip context prep and ingest a prebuilt artifact:

```json
{
  "scripts": {
    "image": "shipfox-docker --image client"
  }
}
```

You can still pass `--tag` explicitly (e.g. for a one-off local build); doing so skips the env-based derivation entirely.

### Environment

- `IMAGE_REGISTRIES` — space-separated registry bases for the derived tags (e.g. `ghcr.io/shipfoxhq docker.io/shipfoxhq`). Each base produces its own tag set; unset means the PR validation path (one local `<name>:ci` tag, no push). Read by name, so a credential variable is never mistaken for a registry.
- `GITHUB_SHA` / `BUILD_NUMBER` / `GITHUB_REF_NAME` — the commit identity for the `sha-<short>`, `build-<number>`, and moving `<branch>` tags.
- `NODE_VERSION` / `PNPM_VERSION` — forwarded as `--build-arg` for the base image.
- `GITHUB_ACTIONS` — enables the gha BuildKit cache.
- `npm_package_name` — the prune target for `--setup-context` (set by the package manager when run through a script).

## License

MIT
