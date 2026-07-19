# External client runtime fixture

This fixture packs the published client runtime closure into a Vite application outside the pnpm
workspace. The application starts from `defaultFeatures()` and adds one external feature that
replaces the login route, adds a settings route, appends providers, contributes navigation and
settings entries, and merges a config fragment.

## Run the required packed gate

The package script builds runtime files and declarations from a clean checkout before packing the
full client closure:

```sh
pnpm --filter=@shipfox/client-shell test:external
```

The gate installs only local tarballs for `@shipfox/*`, checks `dist` resolution under both the
default and `development` conditions, generates the composed TanStack router, builds and type-checks
the consumer, runs the behavioral fixture, and asserts the exact rejected-collision diagnostic. CI
runs this command during static verification.

## Run the linked iteration mode

```sh
pnpm --filter=@shipfox/client-shell test:external -- --link
```

This copies the Vite template to a temporary directory and links the workspace-built closure. It
runs the same generated-route, behavior, collision, and type assertions without packing tarballs.

Both modes remove their temporary directories after completion. The behavioral composition fixture
uses Vitest with JSDOM and does not need browser E2E infrastructure.
