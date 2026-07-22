# @shipfox/client-api

## 4.0.0

### Minor Changes

- 6b4a575: Adds checked client API response boundaries and domain-cached invitation queries.

### Patch Changes

- 781a45b: Fixes Standard Schema response validation when successful results include an undefined issues property.

## 1.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 0.2.0

### Minor Changes

- 3d064b8: Publishes the client runtime closure with shell, feature, route, Vite, and testing contracts.

## 0.0.1

### Patch Changes

- 5d0676a: Add `resetApiClient()` and a shared `@shipfox/client-test-setup` package whose `installClientDomTestEnv()` makes client `dom` Vitest projects isolation-safe: it registers per-test DOM cleanup and API-client reset and installs the jsdom stubs, so a package can run its `dom` project with `isolate: false` without state leaking across files.
