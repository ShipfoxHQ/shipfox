---
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/api-workflows": patch
---

Definition validation normalizes action steps (`uses`) into the workflow model.

- **Model:** `WorkflowModelActionStep` carries the action's path, snapshot digest, name, entry file, input declarations, and integration bindings, plus `with`, `env`, and outputs from the manifest. Every output declares `required` explicitly, and the manifest default is `false`.
- **Validation:** `DefinitionValidationOptions.actionManifests` supplies the manifest and digest for each `uses` path. A step is checked against its manifest: known inputs, required inputs, literal input types, secrets only as whole top-level input values, one connection per integration alias, and connections that exist, match the alias provider, and serve agent tools. Manifest selectors must exist in the provider catalog, and write tools need `allow_write`. An action without a resolved manifest fails with "could not be resolved".
- **Integration context:** `needsIntegrationValidationContext` also returns `true` when a referenced manifest declares integrations.
- **Workflows:** run creation rejects action steps until they can be materialized.
