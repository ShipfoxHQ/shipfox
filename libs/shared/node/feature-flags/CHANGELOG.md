# @shipfox/node-feature-flags

## 0.1.0

### Minor Changes

- 24ea599: Adds a feature flags seam. `@shipfox/feature-flags` declares flags with `defineFlags`. `@shipfox/node-feature-flags` reads them through `createFeatureFlags({provider?})`, resolving a `FLAG_*` env override, then the provider, then the code default. A read never throws. `ShipfoxModule` gains an optional `flags` field, and `defaultModules` accepts a root-created `featureFlags` instance, hands it to the modules, rejects a duplicate flag key, and fails startup on an invalid `FLAG_*` value.

  `DEFINITION_ACTIONS_ENABLED` is replaced by the `definitions-actions` flag, read per workspace. Set `FLAG_DEFINITIONS_ACTIONS=true` where you set `DEFINITION_ACTIONS_ENABLED=true`. The flag defaults to `false`, and the old setting no longer has any effect. The development `.env` sets the override, so local development keeps action steps on.

### Patch Changes

- 041ae63: Two installed copies of these packages now share their process state through `@shipfox/node-process-state` slots: the Postgres pool, the Fastify app, auth methods, and client errors, the default logger, the OpenTelemetry SDK, meter provider, and base logger, the OpenFeature domain counter, outbox write listeners, reported errors, and precise cursor timestamps. `@shipfox/node-module` now reports a duplicate copy of any of them at startup.
- Updated dependencies [24ea599]
- Updated dependencies [c06262b]
- Updated dependencies [2128c1e]
- Updated dependencies [041ae63]
  - @shipfox/feature-flags@0.1.0
  - @shipfox/node-opentelemetry@0.7.0
  - @shipfox/node-process-state@0.1.0
