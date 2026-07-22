---
"@shipfox/client-integrations": major
"@shipfox/client-api": minor
"@shipfox/client-projects": patch
---

Converges the integrations client on a package-owned domain model (camelCase, schema-validated) instead of exposing raw snake_case API DTOs, changing the shape of `useSourceConnectionsQuery`, `useIntegrationConnectionsQuery`, `useIntegrationProvidersQuery`, `useRepositoriesInfiniteQuery`, and the `ConnectionPicker`/`ProviderGrid`/`RepositoryPicker` props. Adds `emptyResponseSchema` to `@shipfox/client-api` for schema-validated DELETE requests with no response body.
