---
"@shipfox/feature-flags": minor
"@shipfox/node-feature-flags": minor
"@shipfox/node-module": minor
"@shipfox/api-server": minor
"@shipfox/api-definitions": minor
---

Adds a feature flags seam. `@shipfox/feature-flags` declares flags with `defineFlags`. `@shipfox/node-feature-flags` reads them through `createFeatureFlags({provider?})`, resolving a `FLAG_*` env override, then the provider, then the code default. A read never throws. `ShipfoxModule` gains an optional `flags` field, and `defaultModules` accepts a root-created `featureFlags` instance, hands it to the modules, rejects a duplicate flag key, and fails startup on an invalid `FLAG_*` value.

`DEFINITION_ACTIONS_ENABLED` is replaced by the `definitions-actions` flag, read per workspace. Set `FLAG_DEFINITIONS_ACTIONS=true` where you set `DEFINITION_ACTIONS_ENABLED=true`. The flag defaults to `false`, and the old setting no longer has any effect. The development `.env` sets the override, so local development keeps action steps on.
