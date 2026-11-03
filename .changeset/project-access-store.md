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

- **Projects:** `GET` and `PUT /projects/:projectId/access`, with admin-only writes and a `PROJECT_ACCESS_CHANGED` audit event. New `connection_access` column and `connection_scopes` and `connection_resources` tables. `getProjectAccessPolicy` and `getProjectAccessPolicies` on the inter-module contract.
- **Projects DTO:** a browser-safe evaluator (`evaluateConnectionAccess`, `evaluateResourceAccess`, `isConnectionNarrowed`, `soleListedConnection`, `defaultCheckoutRepository`) and the policy types.
- **Integrations:** providers can declare `resourceKinds`, `listScopeResources`, and `resolveScopeResource`. GitHub and Gitea do so for repositories. New `GET /integration-connections/:connectionId/scope-resources`, and `getScopeConnection` and `resolveScopeResource` on the inter-module contract.
- **Connection deletion** writes `integrations.connection.deleted`, and Projects removes the matching scopes.
