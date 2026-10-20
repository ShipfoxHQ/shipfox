---
"@shipfox/registry-format": minor
"@shipfox/api-definitions": minor
"@shipfox/api-definitions-dto": patch
"@shipfox/api-agent-access": minor
"@shipfox/api-agent-access-dto": minor
---

Composite actions can be published to the registry.

- **Metadata:** `deriveActionMetadata` records `kind` (`javascript` or `composite`) and marks secret inputs with `secret: true`. Versions published before have no `kind`, and are JavaScript actions.
- **Bumps:** `computeActionBump` makes a change between a JavaScript and a composite action, or a change of an input's `secret` flag, a major bump.
- **Nested actions:** `collectCompositeActions` lists the exact registry actions a composite action uses, for the version document's `actions`. It refuses repository paths and `${{ action.path }}/` paths. `COMPOSITE_ACTION_MAX_FILES` and `COMPOSITE_ACTION_MAX_BYTES` bound a composite bundle.
- **Update notices:** a definition's registry references include the registry actions pinned in the repository composite actions it uses, located at the composite's `action.yml`. Pins inside registry composite actions are left out.
- **Agent access:** `diff_registry_action` reports `kind_change` and `action_changes`, and its input changes cover `secret`. `get_registry_package` describes the composite fields it returns.
