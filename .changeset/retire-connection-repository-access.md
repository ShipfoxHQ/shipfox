---
"@shipfox/api-integration-spi": major
"@shipfox/api-integration-core-dto": major
"@shipfox/api-projects-dto": major
"@shipfox/api-integration-core": major
"@shipfox/api-projects": minor
"@shipfox/client-integrations": major
---

An integration connection no longer has a repository access mode. Every connection reaches all repositories its installation can see, and projects narrow access instead.

- **Release note:** a connection that was set to **Only your projects' repositories** now reaches every repository its installation sees. A project with full access can use all of them. This migration sets every connection to the open behavior and removes the setting. To narrow a project, limit its access.
- **Integration SPI:** `IntegrationConnection` no longer has `repositoryAccessMode`, and `IntegrationConnectionRepositoryAccessMode` is gone.
- **Integration core DTOs:** the `CONNECTION_REPOSITORY_ACCESS_CHANGED` event and the repository access schemas are gone.
- **Projects DTOs:** the inter-module method `listProjectsBySourceConnection` is gone.
- **API:** `GET` and `PUT /integration-connections/:connectionId/repository-access` are removed. The `repository_access` column is dropped from connections and secret cleanups.
- **Integration core:** `IntegrationConnectionRepositoryAccessMode` is no longer exported from the package root.
- **Client:** the connection page no longer shows repository access settings. `RepositoryAccess`, `RepositoryAccessMode`, `RepositoryAccessRepository`, `listIntegrationConnectionRepositoryAccess`, `updateIntegrationConnectionRepositoryAccess`, and the matching query hooks are no longer exported.
