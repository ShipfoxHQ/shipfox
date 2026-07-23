# @shipfox/client-api

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.

## 6.0.0

### Major Changes

- 24be269: Makes checked API adapters the only public business-response boundary and returns package-owned domain models from Agent, Integrations, and Workflows adapters.

### Minor Changes

- c02ac42: Converges the integrations client on a package-owned domain model (camelCase, schema-validated) instead of exposing raw snake_case API DTOs, changing the shape of `useSourceConnectionsQuery`, `useIntegrationConnectionsQuery`, `useIntegrationProvidersQuery`, `useRepositoriesInfiniteQuery`, and the `ConnectionPicker`/`ProviderGrid`/`RepositoryPicker` props. Adds `emptyResponseSchema` to `@shipfox/client-api` for schema-validated DELETE requests with no response body.

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
