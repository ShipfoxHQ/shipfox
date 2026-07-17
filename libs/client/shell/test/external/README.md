# External client composition fixture

This fixture proves the candidate client composition contract from a Vite application outside the
pnpm workspace. It is a manual evidence gate for ENG-962 and does not add a CI job.

## Prerequisites

Build runtime files, declarations, and the closure helper before running either mode:

```sh
turbo build type:emit \
  --filter=@shipfox/client-shell-fixture-feature... \
  --filter=@shipfox/application-release
```

## Run the fast linked mode

```sh
node libs/client/shell/test/external/verify.mjs --link
```

This copies the Vite template to a temporary directory and links the workspace-built closure. It
runs a Vite build, one compact jsdom render test, a consumer type-check, and the rejected-collision
build.

## Run the packed exit gate

```sh
node libs/client/shell/test/external/verify.mjs
```

This computes the runtime workspace closure rooted at `@shipfox/client-shell` and the toy feature,
packs every package, and installs only those tarballs for `@shipfox/*` dependencies. It repeats the
linked checks against default `dist` exports and verifies no candidate package came from the
workspace or registry.

Both modes remove their temporary directories after completion. Neither mode needs browser E2E
infrastructure or adds work to the normal CI test graph.
