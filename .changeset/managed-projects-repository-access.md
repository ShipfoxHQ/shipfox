---
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/client-workflows": patch
---

Lets a managed project reach every repository the GitHub App can see. New connections start with access to all repositories, and existing connections keep their mode. A managed project has no default checkout, so a job checks out only what it names. A `checkout:` with a `repository` and tools with no `connection` use the workspace's only source-control connection, and ask for a `connection` when there is none or several.
