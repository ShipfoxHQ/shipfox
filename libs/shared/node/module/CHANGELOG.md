# @shipfox/node-module

## 0.3.0

### Minor Changes

- 3976f8c: Adds module login-method declarations, validates server compositions before startup, and adds password-login route configuration.

### Patch Changes

- Updated dependencies [c5ee18f]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-temporal@0.3.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/node-fastify@0.2.2

## 0.2.0

### Minor Changes

- 0cd6dd4: Adds stoppable module workers and declarative module startup tasks for server composition.
- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [a68458a]
- Updated dependencies [6eba800]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-temporal@0.2.0
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- d6d4862: Add a Sentry integration provider that ingests issue webhooks.
  - New `@shipfox/api-integration-sentry` + `-sentry-dto` packages: a webhook
    receiver that verifies the HMAC-SHA256 signature (keyed with the app client
    secret), dedups on `Request-ID`, normalizes the issue payload, and publishes
    `integrations.event.received` with `source: 'sentry'` and `event:
issue.<action>`. A raw `ignored` action is normalized to `archived`. Malformed,
    bad-JSON, unknown-action, and unknown-resource deliveries are recorded-and-dropped
    with a 204 (deliberate deviation from GitHub's 400 to avoid Sentry disabling the
    webhook).
  - `@shipfox/api-integration-core-dto`: add the `SentryIssuePayload` contract.
  - `@shipfox/api-integration-core`: register the Sentry provider behind
    `INTEGRATIONS_ENABLE_SENTRY_PROVIDER`, add the
    `updateIntegrationConnectionLifecycleStatus` helper, and pin stable
    migration-tracking table names per provider database.
  - `@shipfox/node-fastify`: add the shared `rawBodyPlugin` and `WEBHOOK_BODY_LIMIT`
    exports for webhook receivers.
  - `@shipfox/node-module`: add an optional `migrationsTableName` to `ModuleDatabase`
    so conditionally-composed databases get a position-independent migration table.
  - `@shipfox/api-integration-github`: consume the shared `rawBodyPlugin` instead of
    a local copy (internal refactor, no behavior change).

  Deploy note: environments with GitHub enabled must rename the existing
  `__drizzle_migrations_integrations_1` table to
  `__drizzle_migrations_integrations_github` as part of this release, or GitHub
  migrations re-run against existing tables.

- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- 9c149d1: Adds an app-owned runtime worker failure callback and fail-fast worker startup errors so API services can treat module-declared Temporal workers as process health dependencies.

### Patch Changes

- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- 75520ff: Add the foundation for metrics observability. `@shipfox/node-module` gains an optional `metrics` hook on `ShipfoxModule` plus `registerModuleMetrics`, a declarative slot for modules to register service-level metrics (observable gauges) once at app startup, kept separate from `initializeModules` so unit tests never bind the metrics port. `@shipfox/api-runners` is instrumented as the worked example across both planes: instance counters for job enqueue, claim, and lease expiry recorded inline, and `runners_pending_jobs` / `runners_running_jobs` observable gauges over a new `getJobQueueDepth` query wired through the module hook.
- Updated dependencies [34ba284]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
- Updated dependencies [e47f8da]
- Updated dependencies [7b175f5]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [f92122b]
- Updated dependencies [857fd73]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-outbox@0.1.0
