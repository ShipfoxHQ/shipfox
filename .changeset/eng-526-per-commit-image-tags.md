---
"@shipfox/docker": minor
---

Derive the per-commit tag set from the environment with a new `--image <name>` flag, so one `turbo image --filter …` tags every app. The workflow supplies the ref — registry bases as a space-separated `IMAGE_REGISTRIES` list (e.g. `ghcr.io/shipfoxhq`) and the commit identity as `GITHUB_SHA` / `BUILD_NUMBER` / `GITHUB_REF_NAME` — and the package script passes the image name; for each registry base `shipfox-docker` emits `<base>/<name>:sha-<short>`, `:build-<number>`, and `:<branch>`. With `IMAGE_REGISTRIES` unset (the PR validation path) it emits a single local `<name>:ci` tag so a `--load` build has a reference. An explicit `--tag` still takes precedence and skips derivation.
