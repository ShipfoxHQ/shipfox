---
"@shipfox/workflow-document": minor
"@shipfox/actions": minor
"@shipfox/registry-format": minor
"@shipfox/api-integration-core-dto": major
"@shipfox/api-integration-core": major
"@shipfox/api-definitions-dto": major
"@shipfox/api-definitions": major
"@shipfox/api-agent-access-dto": major
"@shipfox/api-workflows": patch
"@shipfox/api-agent": patch
"@shipfox/workflow-templates": patch
---

Naming a write tool in `include` now grants it. `allow_write` is no longer needed on agent steps, agent files, or action manifests.

- **Schemas:** `allow_write` still parses on an integration and on an action manifest alias, so existing files keep working. It is marked deprecated and has no effect. A parsed manifest no longer defaults it to `false`.
- **Sync:** definition sync no longer reports `integration-write-not-allowed`. A nested action alias must fit the selectors of the alias above it, with no separate write check.
- **Workflow model:** `WorkflowModelStepIntegration` and `WorkflowModelActionIntegration` drop `allowWrite`.
- **Integrations:** `resolveAgentTools` and `resolveAgentToolsBatch` drop the `allowWrite` input and the `write-not-allowed` reason. They also refuse the `*` selector, which definition sync already rejected, so every granted tool is named.
- **Registry:** `derived.capabilities` drops `allow_write`, and versions published with it still parse. `diffActionCapabilities` no longer reports `write_enabled` or `write_disabled`, and `allow_write` no longer affects the minimum bump.
- **Action tests:** `runAction` lets an action call every tool its manifest includes.
- **Templates:** `ticket-to-pr` no longer sets `allow_write`.
