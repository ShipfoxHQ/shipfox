---
"@shipfox/api-integration-core": major
"@shipfox/api-integration-core-dto": major
"@shipfox/api-integration-github": major
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/client-workflows": patch
---

The calling project's access now decides every repository and connection check on checkout and on integration tools.

- **Checkout:** a job that checks out a repository outside its project's access fails, and a by-name checkout is pinned to the id of the repository it matches in the project's access. A running job loses access at its next credential renewal after the repository is removed.
- **Tools:** a tool call on a connection or repository outside the project's access is denied with `connection-not-allowed` or `repository-not-granted`. A call with no project is refused. An agent step, tool step, or action that names a connection outside access fails at materialization with `connection-not-allowed`.
- **Validation:** a workflow that names a connection outside the project's access gets a warning.
- **Contract:** `createCheckoutSpec` and `createCheckoutCredentials` require the calling `projectId`. `getAgentToolsContext` takes `projectId` and marks each connection `allowed`. Checkout renewal subjects store their `project_id`.
- **Removed:** the 30-second shared authorization cache, the `RepositoryAuthorizationMode` type export, and the `invalidateRepositoryAuthorizationCache` option on the provider load options and the GitHub provider options. A change to access applies on the next call.
