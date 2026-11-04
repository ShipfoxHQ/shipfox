---
"@shipfox/api-integration-azure-devops": minor
"@shipfox/api-integration-azure-devops-dto": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-webhook-dto": patch
"@shipfox/client-integrations": minor
"@shipfox/react-ui": minor
"@shipfox/integration-icons": minor
---

Add an Azure DevOps Services integration behind `INTEGRATIONS_ENABLE_AZURE_DEVOPS_PROVIDER`. A workspace connects an organization with a personal access token, stored in workspace secrets. Projects can check out Azure Repos repositories and sync workflows from them, and Service Hooks (push, pull request, pull request comment, build completed) start workflows. Hooks authenticate with per-connection basic-auth credentials, since Azure DevOps does not sign them. Agents get `get_pull_request`, `create_pull_request` (draft by default) and `comment_on_pull_request`.
