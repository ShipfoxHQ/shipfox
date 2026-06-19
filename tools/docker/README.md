# @shipfox/docker

Workspace wrapper around `docker buildx` for building Shipfox app images. It prepares the build context and runs a single multi-platform build, so adding a new app image is a one-file change. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **`shipfox-docker`**: Runs `docker buildx build` for the current package, with sensible defaults for a multi-arch push.
- **Context prep (`--setup-context`)**: Runs `turbo prune --docker --out-dir out <pkg>` and overlays each pruned package's prebuilt `dist/` into `out/full/`. This is the "build outside Docker, ingest `dist`" approach: the image never recompiles TypeScript, it ingests the turbo-cached build plus a real `node_modules`.
- **Single multi-platform build**: Defaults to `--platform linux/amd64,linux/arm64 --push`, so one invocation emits the multi-arch manifest (no per-arch tags, no `docker manifest` step). QEMU covers both arches.
- **gha BuildKit cache**: Adds `--cache-from`/`--cache-to type=gha` (scoped per image) when running in GitHub Actions.

The defaults are added only when you did not pass the flag yourself, so the caller stays in control. To validate a Dockerfile on a PR (single arch, no push), pass your own `--platform linux/amd64` and `--load`.

## Installation

```bash
pnpm add -D @shipfox/docker
```

> [!NOTE]
> `shipfox-docker` calls `docker buildx`, so you need the Docker CLI with Buildx. A multi-arch build also needs QEMU. In CI, `docker/setup-qemu-action` and `docker/setup-buildx-action` set both up.

## Usage

Add an `image` script to the app's `package.json`. Tags target both registries in one build:

```json
{
  "scripts": {
    "image": "shipfox-docker --setup-context --tag ghcr.io/shipfoxhq/api:sha-abc1234 --tag shipfoxhq/api:sha-abc1234"
  }
}
```

Static apps (no `node_modules`) skip context prep and ingest a prebuilt artifact:

```json
{
  "scripts": {
    "image": "shipfox-docker --tag ghcr.io/shipfoxhq/client:sha-abc1234"
  }
}
```

### Environment

- `NODE_VERSION` / `PNPM_VERSION` — forwarded as `--build-arg` for the base image.
- `GITHUB_ACTIONS` — enables the gha BuildKit cache.
- `npm_package_name` — the prune target for `--setup-context` (set by the package manager when run through a script).

## License

MIT
