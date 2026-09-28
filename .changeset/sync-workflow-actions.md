---
"@shipfox/api-definitions-dto": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-definitions": patch
---

Definition sync reads the actions that workflows reference with `uses`, at the same commit as the workflows. It stores their snapshots before it applies the definitions. Sync accepts `uses` only while `DEFINITION_ACTIONS_ENABLED` is on.

- **Change detection:** a workflow with actions hashes its YAML together with the digests of its actions, so a commit that changes only action code produces a new definition. Workflows without actions keep their YAML-only hash.
- **Sync error codes:** the sync state error code enums add `action-not-found`, `action-invalid`, `action-too-large`, and `action-unsupported-file`, with a migration for `definitions_sync_error_code`. Manifest diagnostics name the `action.yml` path as their file.
- **Warnings:** a relative import that does not resolve inside an action gives an `action-import-unresolved` warning on the importing file.
