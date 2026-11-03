---
"@shipfox/api-projects": minor
"@shipfox/api-projects-dto": minor
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-github": minor
"@shipfox/api-integration-gitea": minor
---

A project can store and read its access: the connections it can use and, for each, the repositories it can reach. Nothing enforces it yet.

- **Projects:** `GET` and `PUT /projects/:projectId/access`, with admin-only writes. A linked project's config connection can be saved with zero repositories, which means only the config repository. A repository rename updates the stored names of a listed repository.
- **Projects DTO:** a browser-safe access evaluator and the policy types, and `getProjectAccessPolicy` and `getProjectAccessPolicies` on the inter-module contract.
- **Integrations:** providers can declare resource kinds and list and resolve their resources. GitHub and Gitea do so for repositories, and `GET /integration-connections/:connectionId/scope-resources` serves the picker.
- **Connection deletion** of every kind writes `integrations.connection.deleted`, and Projects removes the matching scopes.
