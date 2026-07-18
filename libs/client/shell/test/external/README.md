# External client runtime fixture

This fixture packs the published client runtime closure into a Vite application outside the pnpm
workspace. It is a manual structural gate and does not add a CI job.

## Prerequisites

Build runtime files, declarations, and the closure helper before running either mode:

```sh
turbo build type:emit \
  --filter='./libs/client/**' \
  --filter=@shipfox/application-release
```

## Run the fast linked mode

```sh
node libs/client/shell/test/external/verify.mjs --link
```

This copies the Vite template to a temporary directory and links the workspace-built closure. It
runs a Vite build and resolves every non-pattern declaration entry point from the consumer.

## Run the packed exit gate

```sh
node libs/client/shell/test/external/verify.mjs
```

This computes the runtime workspace closure from the client roots in
`publication-closure.json`, packs every package, and installs only those tarballs for
`@shipfox/*` dependencies. It repeats the linked checks against default `dist` exports and
verifies no candidate package came from the workspace or registry.

Both modes remove their temporary directories after completion. The behavioral composition fixture
and required CI gate are part of ENG-995; neither mode needs browser E2E infrastructure or adds
work to the normal CI test graph. Its source files and Vitest wiring remain in the fixture template
for that follow-up.
