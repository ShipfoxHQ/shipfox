---
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-github": minor
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/client-workflows": patch
---

The calling project's access now decides every repository and connection check on checkout and on integration tools.

- **Checkout:** a job that checks out a repository outside its project's access fails, and a by-name checkout is pinned to the repository access named. A running job loses access at its next credential renewal after the repository is removed, because each renewal checks current access.
- **Tools:** a tool call on a connection or repository outside the project's access is denied with `connection-not-allowed` or `repository-not-granted`. A call with no project is refused. An agent step, tool step, or action that names a connection outside access fails at materialization with `connection-not-allowed`.
- **Validation:** a workflow that names a connection outside the project's access gets a warning.
- **Contract:** `createCheckoutSpec` and `createCheckoutCredentials` require the calling `projectId`. `getAgentToolsContext` takes `projectId` and marks each connection `allowed`. Checkout renewal subjects store their `project_id`.
- **Removed:** the 30-second shared authorization cache and its invalidation hook. A change to access applies on the next call.
