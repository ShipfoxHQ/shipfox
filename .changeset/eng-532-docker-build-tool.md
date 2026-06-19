---
"@shipfox/docker": minor
---

Add the `@shipfox/docker` tool exposing a `shipfox-docker` CLI that wraps `docker buildx`. It prepares the build context with `--setup-context` (turbo prune plus an overlay of each pruned package's prebuilt `dist/`, the "build outside Docker, ingest dist" approach) and runs a single multi-platform build that pushes a multi-arch image to multiple registries in one pass. It defaults `--platform`, `--push`, and the gha BuildKit cache only when the caller did not set them, so a PR can still build single-arch without pushing.
