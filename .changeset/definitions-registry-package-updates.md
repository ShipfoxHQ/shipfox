---
'@shipfox/api-definitions': minor
'@shipfox/api-definitions-dto': minor
'@shipfox/workflow-templates': minor
---

Definitions record the registry packages they use and report newer versions.

- **Refs:** Each sync records the registry actions a workflow pins and the parsed `# shipfox-template:` header in a new `registry_refs` column. A pre-registry header is recorded as legacy and gets no notice.
- **Notices:** `GET /workspaces/:workspaceId/definitions/:definitionId/package-updates` returns, per reference, the latest version, whether it is behind, the highest bump over the skipped versions, whether an action widens its capabilities, the newest changelog entries, and the upgrade prompt for a template. It is separate from the definition read, so definition pages never wait on the registry.
- **Prompt:** `buildUpgradePrompt` from `@shipfox/workflow-templates/prompt` writes the prompt a user pastes into a coding agent to upgrade a template.
